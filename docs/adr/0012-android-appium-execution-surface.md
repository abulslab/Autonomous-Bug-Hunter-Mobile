# ADR 0012: Android Emulator & Appium (`UiAutomator2`) Execution Surface

Status: Accepted

## Context

[ADR 0011](0011-the-execution-surface-is-a-port.md) established that the execution surface is a port: the core quality-engineering engine (`Projects`, `Knowledge`, `Understanding`, `Twin`, `Predictions`, `InvariantRules`, `Probes`, `Replayer`, `Journeys`, `Review`, `Learning`, and `Readiness`) interacts with the application under test strictly through the worker protocol (`Open`, `Act`, `Snapshot`, `Request`, `Close`) and evaluates `PageSnapshot` + `NetworkEvent` records rather than depending on browser internals.

`Autonomous-Bug-Hunter-Mobile` is the concrete proof of that architectural boundary for Android mobile applications.

## Decision

1. **Real Native Android Target APKs (`android/`)**:
   - We ship a multi-flavor Kotlin + Jetpack Compose Android Gradle project (`android/app/build.gradle.kts`) that compiles three real `.apk` binaries into `android/apks/`:
     - `DemoShopMobile.apk` (`com.bughunter.mobile.shop`) — native Compose e-commerce app with Catalog, Cart & Checkout, Orders, Staff Order Desk, and Sign-In screens.
     - `DemoHotelMobile.apk` (`com.bughunter.mobile.hotel`) — native Compose hotel booking app with Rooms & Book, My Stays, and Front Desk check-in/check-out screens.
     - `VoiceAppointmentMobile.apk` (`com.bughunter.mobile.voice`) — native Compose voice & chat clinic scheduling app with an embedded NanoHTTPD `/evaluate` server (`port 8080`, forwarded via `adb forward tcp:18080 tcp:8080`).
   - All Compose interactive controls expose semantic resource IDs (`testTagsAsResourceId = true` + `Modifier.testTag(...)`) for `UiAutomator2` and accessibility inspection.

2. **Mobile Worker Surface (`src/browser-worker/server.mjs`)**:
   - Implements the same five-operation worker protocol (`POST /sessions`, `POST /sessions/:id/act`, `POST /sessions/:id/snapshot`, `POST /sessions/:id/request`, `DELETE /sessions/:id`) plus Android device lifecycle endpoints:
     - `GET /device/status` — inspects `adb devices`, `sys.boot_completed`, Appium server health (`http://127.0.0.1:4723/status`), and installed/built `.apk` packages.
     - `POST /device/emulator/start` — boots the `Pixel_8` AVD (`Android 16 / API 36`), configures `adb reverse` (`tcp:5290`, `tcp:5291`, `tcp:5299`) and `adb forward` (`tcp:18080 -> tcp:8080`), installs the `.apk` files via `adb install -r`, launches the target `MainActivity`, and starts Appium (`UiAutomator2`).
     - `POST /device/emulator/show` & `POST /device/emulator/stop` — foregrounds or terminates the Android Emulator window.
     - `GET /device/stream` — streams live `adb exec-out screencap -p` frames as `multipart/x-mixed-replace`.
   - Harvests `adb logcat -d AndroidRuntime:E ActivityManager:E` on every snapshot so unhandled `FATAL EXCEPTION` crashes and `ANR in` freezes flow into `PageSnapshot.Console` as `logcat-crash` and `logcat-anr` events.

3. **Mobile Oracles, Skill Pack & Appium Reproduction Specs**:
   - `Oracles.cs` adds deterministic `android-crash` (`Critical`) and `android-anr` (`High`) oracles alongside all existing money, validation, search, and API consistency oracles.
   - `SpecWriter.cs` adds `SpecWriter.WriteAppium(Hunt, Finding)` to generate standalone WebdriverIO + Appium (`UiAutomator2`) reproduction tests targeting the real `.apk` package (`com.bughunter.mobile.{shop|hotel|voice}`) on `Pixel_8`.
   - `skills/mobile-android.md` adds mobile-specific heuristics (back-stack navigation, tab switching, activity recreation, deep-link role boundaries, and `logcat` runtime stability).

## Consequences

- **Zero Core Engine Duplication**: 100% of the QE intelligence layer from `Autonomous-Bug-Hunter-Web` is reused unchanged.
- **Dual Reproducibility**: Every confirmed finding produces both an Appium (`UiAutomator2`) test for native Android execution and a mobile-viewport Playwright test for fast CI verification.
