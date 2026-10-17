// Copy this file to secrets.h (same folder) and change the values.
// secrets.h is gitignored; if it's missing, the build uses these example values.
#pragma once

// Must be the same as KEY_SECRET in the project's .env, or the phone terminal
// will refuse every key code ("Key code doesn't match").
#define KEY_SECRET "change-me-to-a-long-random-string"

// Printed on the fake debit card's record (card writer only).
#define CARD_LAST4 "4821"
#define CARD_HOLDER "ALBERT GATOR"
