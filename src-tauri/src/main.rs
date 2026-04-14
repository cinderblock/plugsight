// Prevents a console window from opening on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    env_logger::init();
    device_manager_pp_lib::run();
}
