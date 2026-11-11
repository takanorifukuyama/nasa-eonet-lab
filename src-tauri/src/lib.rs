use std::time::Duration;

/// Only allow a narrowly-scoped, read-only EONET request. No arbitrary URL is accepted.
#[tauri::command]
async fn fetch_eonet(days: u16, status: String, limit: u16) -> Result<serde_json::Value, String> {
    if !(1..=365).contains(&days) {
        return Err("days must be between 1 and 365".into());
    }
    if !(1..=700).contains(&limit) {
        return Err("limit must be between 1 and 700".into());
    }
    if !matches!(status.as_str(), "open" | "closed" | "all") {
        return Err("status must be open, closed, or all".into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(25))
        .user_agent("NASA-EONET-Lab/0.1 (open-source educational client)")
        .build()
        .map_err(|e| format!("HTTP client configuration failed: {e}"))?;
    let response = client
        .get("https://eonet.gsfc.nasa.gov/api/v3/events")
        .query(&[("days", days.to_string()), ("status", status), ("limit", limit.to_string())])
        .send()
        .await
        .map_err(|e| format!("NASA EONET request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("NASA EONET returned an error: {e}"))?;
    let data: serde_json::Value = response.json().await.map_err(|e| format!("Invalid NASA EONET JSON: {e}"))?;
    if !data.get("events").is_some_and(|events| events.is_array()) {
        return Err("NASA EONET response does not contain an events array".into());
    }
    Ok(data)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![fetch_eonet])
        .run(tauri::generate_context!())
        .expect("failed to start NASA EONET Lab");
}
