// Copy this file to secrets.h (same folder) and change the values.
// secrets.h is gitignored; if it's missing, the build uses these example values.
#pragma once

// Must be the same as KEY_SECRET in the project's .env, or the phone terminal
// will refuse every key code ("Key code doesn't match").
#define KEY_SECRET "change-me-to-a-long-random-string"

// The one key fob this device may rewrite (its UID in hex, as the serial log prints it
// after PLACED). Any other tag, including the debit card, is left untouched.
// Leave it "" to allow any tag except one holding a card (SC1) record.
#define KEY_UID ""

// Printed on the fake debit card's record (card writer only).
#define CARD_LAST4 "4821"
#define CARD_HOLDER "ALBERT GATOR"
