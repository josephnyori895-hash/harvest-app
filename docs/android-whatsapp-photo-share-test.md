# Harvest Android — WhatsApp Photo Sharing Test

## Purpose
Repeatably verify that a photo sent in Harvest Chat can be shared to WhatsApp, including the Android share-sheet flow, cancellation, URL fallback, and recipient verification.

## Preconditions
- Install the current Harvest Android APK on Device A.
- Install WhatsApp on Device A.
- Have Sender and Recipient Harvest accounts.
- Sender and recipient can access the same Harvest chat.
- Sender has network access.
- Record the APK version and Git commit.

## A. Native share-sheet happy path
1. Open Harvest → Chats.
2. Open a conversation containing a Harvest photo.
3. Open the photo message action menu.
4. Tap Share photo.
5. Wait for the Android share sheet.
6. Select WhatsApp.
7. Select the intended WhatsApp recipient/chat.
8. Add a unique marker such as HARVEST-WA-<date-time> if available.
9. Send the WhatsApp message.
10. On the recipient side, open the WhatsApp conversation.
11. Verify the received item is the actual photo, not only a Harvest URL.
12. Open the photo and verify it displays normally.

Expected: Android share sheet opens; WhatsApp is available when installed; WhatsApp receives an image attachment; recipient can open it; returning to Harvest does not change unread/seen state.

## B. Cancel-share test
1. Repeat A1–A5.
2. Press Back or otherwise cancel the Android share sheet.
3. Return to Harvest.

Expected: Harvest remains open; no WhatsApp message is sent; normal cancellation produces no error; the Harvest photo remains available; unread/seen behavior is unchanged.

## C. Native-share unavailable / URL fallback
This validates the fallback path when file sharing is unavailable. Use a debug/device configuration where navigator.share is unavailable, or a temporary debug build that forces the fallback branch.

1. Open the same Harvest photo message.
2. Tap Share photo.
3. Trigger the no-file-share fallback.
4. Verify text/URL sharing is offered.
5. If the Android text share sheet opens, select WhatsApp.
6. Send the generated Harvest media URL to the test recipient.
7. Open the WhatsApp message on the recipient device.
8. Open the URL and verify it displays the intended photo while authorized and valid.

Expected: fallback shares a usable media URL and does not falsely claim to attach the binary image. Invalid or expired authorization must not expose private media.

Note: URL fallback is not equivalent to a WhatsApp image attachment.

## D. Recipient verification
| Check | Result |
|---|---|
| Correct WhatsApp recipient | PASS / FAIL |
| Message arrived | PASS / FAIL |
| Actual image attachment | PASS / FAIL |
| Image opens normally | PASS / FAIL |
| Caption/test marker present | PASS / FAIL |
| No unexpected URL-only message | PASS / FAIL |
| Harvest chat works after return | PASS / FAIL |
| Harvest unread/seen state unchanged | PASS / FAIL |

A native-share test is not passed merely because WhatsApp opened. The recipient must receive and open the image.

## E. Evidence
Record date/time, APK version, Git commit, Android version, device model, WhatsApp version, sender/recipient accounts, test marker, native-share availability, whether WhatsApp was selected, recipient delivery result, cancel result, fallback result, and notes.

Capture screenshots of: Harvest Share photo action menu; Android share sheet with WhatsApp; WhatsApp composer showing the photo; recipient WhatsApp conversation; fallback URL message when applicable.

## Release gate
- [ ] Native file-share test passes.
- [ ] Cancel-share test passes.
- [ ] URL fallback test passes.
- [ ] Recipient receives and opens the actual image.
- [ ] No regression in Harvest unread/seen behavior.
- [ ] Evidence recorded for the tested APK/commit.

## Automation boundary
Repository CI can validate TypeScript, lint, build, and static behavior. WhatsApp recipient delivery requires a real Android device and WhatsApp, so this is a repeatable device-level E2E procedure, not a claim of CI verification.