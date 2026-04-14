//! Extract real Windows device class icons via SetupAPI.
//!
//! Uses `SetupDiLoadClassIcon` to get the HICON for each device setup class,
//! then renders it onto a 32bpp DIB section and encodes to PNG (base64 data URL).
//! Results are cached in-process since icons never change at runtime.

use std::collections::HashMap;
use std::sync::Mutex;

use base64::Engine as _;
use windows::core::GUID;
use windows::Win32::Devices::DeviceAndDriverInstallation::SetupDiLoadClassIcon;
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, SelectObject,
    BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
};
use windows::Win32::UI::WindowsAndMessaging::{
    DestroyIcon, DrawIconEx, HICON, DI_NORMAL,
};

/// Thread-safe cache: class GUID string → base64 data URL.
static ICON_CACHE: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

/// Extract icons for a batch of class GUIDs.
/// Returns a map of GUID → `data:image/png;base64,...` strings.
/// GUIDs that fail extraction are omitted from the result.
pub fn get_class_icons_batch(guids: &[String]) -> HashMap<String, String> {
    let mut cache = ICON_CACHE.lock().unwrap();
    let cache = cache.get_or_insert_with(HashMap::new);

    let mut result = HashMap::new();
    for guid_str in guids {
        // Check cache first.
        if let Some(cached) = cache.get(guid_str) {
            result.insert(guid_str.clone(), cached.clone());
            continue;
        }

        // Extract and cache.
        match extract_class_icon(guid_str) {
            Ok(data_url) => {
                cache.insert(guid_str.clone(), data_url.clone());
                result.insert(guid_str.clone(), data_url);
            }
            Err(e) => {
                log::warn!("Failed to extract icon for {guid_str}: {e}");
                // Cache empty string so we don't retry.
                cache.insert(guid_str.clone(), String::new());
            }
        }
    }
    result
}

/// Parse a GUID string like `{4d36e968-e325-11ce-bfc1-08002be10318}` into a `windows::core::GUID`.
fn parse_guid(s: &str) -> Result<GUID, String> {
    let s = s.trim_matches(|c| c == '{' || c == '}');
    let parts: Vec<&str> = s.split('-').collect();
    if parts.len() != 5 {
        return Err(format!("Invalid GUID format: {s}"));
    }

    let data1 = u32::from_str_radix(parts[0], 16).map_err(|e| format!("GUID parse error: {e}"))?;
    let data2 = u16::from_str_radix(parts[1], 16).map_err(|e| format!("GUID parse error: {e}"))?;
    let data3 = u16::from_str_radix(parts[2], 16).map_err(|e| format!("GUID parse error: {e}"))?;

    let mut data4 = [0u8; 8];
    let hex34 = format!("{}{}", parts[3], parts[4]);
    if hex34.len() != 16 {
        return Err(format!("Invalid GUID data4 length: {}", hex34.len()));
    }
    for (i, chunk) in hex34.as_bytes().chunks(2).enumerate() {
        let byte_str = std::str::from_utf8(chunk).map_err(|e| format!("GUID parse error: {e}"))?;
        data4[i] = u8::from_str_radix(byte_str, 16).map_err(|e| format!("GUID parse error: {e}"))?;
    }

    Ok(GUID {
        data1,
        data2,
        data3,
        data4,
    })
}

/// Extract the icon for a single device class GUID.
fn extract_class_icon(guid_str: &str) -> Result<String, String> {
    let guid = parse_guid(guid_str)?;
    let mut hicon = HICON::default();

    unsafe {
        // Load the class icon via SetupAPI.
        SetupDiLoadClassIcon(&guid, Some(&mut hicon), None)
            .map_err(|e| format!("SetupDiLoadClassIcon failed: {e}"))?;
    }

    let result = hicon_to_png_data_url(hicon);

    // Always clean up the icon.
    unsafe {
        let _ = DestroyIcon(hicon);
    }

    result
}

/// Convert an HICON to a `data:image/png;base64,...` string.
fn hicon_to_png_data_url(hicon: HICON) -> Result<String, String> {
    const SIZE: i32 = 32;

    unsafe {
        // Create a memory DC.
        let hdc = CreateCompatibleDC(None);
        if hdc.is_invalid() {
            return Err("CreateCompatibleDC failed".into());
        }

        // Create a 32bpp DIB section.
        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: SIZE,
                biHeight: -SIZE, // Top-down DIB (negative = top-down scanline order).
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };

        let mut bits_ptr: *mut std::ffi::c_void = std::ptr::null_mut();
        let hbmp = CreateDIBSection(hdc, &mut bmi, DIB_RGB_COLORS, &mut bits_ptr, None, 0)
            .map_err(|e| format!("CreateDIBSection failed: {e}"))?;

        if bits_ptr.is_null() {
            let _ = DeleteDC(hdc);
            return Err("CreateDIBSection returned null bits pointer".into());
        }

        // Select the bitmap into the DC.
        let old_bmp = SelectObject(hdc, hbmp);

        // Draw the icon onto the DIB section.
        DrawIconEx(
            hdc,
            0,
            0,
            hicon,
            SIZE,
            SIZE,
            0,
            None,
            DI_NORMAL,
        ).map_err(|e| {
            SelectObject(hdc, old_bmp);
            let _ = DeleteObject(hbmp);
            let _ = DeleteDC(hdc);
            format!("DrawIconEx failed: {e}")
        })?;

        // Read the raw BGRA pixels from the DIB section.
        let pixel_count = (SIZE * SIZE) as usize;
        let byte_count = pixel_count * 4;
        let pixels = std::slice::from_raw_parts(bits_ptr as *const u8, byte_count);

        // Convert BGRA (pre-multiplied alpha) → RGBA (straight alpha) for PNG.
        let mut rgba = vec![0u8; byte_count];
        for i in 0..pixel_count {
            let b = pixels[i * 4];
            let g = pixels[i * 4 + 1];
            let r = pixels[i * 4 + 2];
            let a = pixels[i * 4 + 3];

            if a == 0 {
                // Fully transparent — leave as 0,0,0,0.
            } else if a == 255 {
                // Fully opaque — no un-premultiply needed.
                rgba[i * 4] = r;
                rgba[i * 4 + 1] = g;
                rgba[i * 4 + 2] = b;
                rgba[i * 4 + 3] = 255;
            } else {
                // Un-premultiply: divide by alpha.
                let af = a as f32;
                rgba[i * 4] = ((r as f32 / af) * 255.0).min(255.0) as u8;
                rgba[i * 4 + 1] = ((g as f32 / af) * 255.0).min(255.0) as u8;
                rgba[i * 4 + 2] = ((b as f32 / af) * 255.0).min(255.0) as u8;
                rgba[i * 4 + 3] = a;
            }
        }

        // Clean up GDI resources.
        SelectObject(hdc, old_bmp);
        let _ = DeleteObject(hbmp);
        let _ = DeleteDC(hdc);

        // Encode to PNG.
        let mut png_buf: Vec<u8> = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut png_buf, SIZE as u32, SIZE as u32);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder
                .write_header()
                .map_err(|e| format!("PNG header error: {e}"))?;
            writer
                .write_image_data(&rgba)
                .map_err(|e| format!("PNG write error: {e}"))?;
        }

        // Base64 encode.
        let b64 = base64::engine::general_purpose::STANDARD.encode(&png_buf);
        Ok(format!("data:image/png;base64,{b64}"))
    }
}
