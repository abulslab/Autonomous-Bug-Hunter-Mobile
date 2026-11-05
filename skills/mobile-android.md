---
name: mobile-android
title: Android mobile lifecycle, navigation & touch interactions
match: android, mobile, appium, uiautomator2, apk, emulator, permission, back, tab, screen
---

## Risks
- Back-stack & tab switching: switching bottom-navigation tabs or pressing Android system Back after a mutating action (adding to cart, applying a coupon, cancelling an order or booking) must not show stale totals, duplicate submissions, or resurrect cancelled items.
- Activity recreation & reload: backgrounding/reloading the Android activity must preserve authenticated session state, active cart lines, and confirmed bookings without losing server-synced data.
- Deep links & role boundaries: opening a staff or front-desk screen directly (`Staff`, `Front Desk`, `/api/staff/*`) without an active staff session must be rejected by the backend API, not merely hidden in the mobile UI.
- Input & soft-keyboard edge cases: numeric quantity and guest fields on Android soft keyboards may submit negative numbers (`-1`), zero (`0`), or out-of-range values; server validation must reject invalid mobile form payloads.
- Runtime stability: no user interaction or API error response should trigger an unhandled `AndroidRuntime` `FATAL EXCEPTION` crash or `ActivityManager` `ANR in` freeze in `adb logcat`.

## Rules
- On staff endpoints (`/api/staff/*`): unauthenticated or guest session tokens return `status >= 400`
- On state-changing actions (checkout, booking, cancellation): UI state after tab switch or Back navigation matches the latest GET response

## Probe values
- Numeric inputs: `-1`, `0`, `999`
- Auth headers: drop `X-Staff-Session` / `Authorization` on protected mobile API calls
- Case sensitivity: uppercase and mixed-case search queries from mobile search bars
