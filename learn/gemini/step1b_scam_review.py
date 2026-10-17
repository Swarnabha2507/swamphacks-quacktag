"""Step 1b: make Gemini answer in a fixed JSON shape, so code can use the answer.

    py learn/gemini/step1b_scam_review.py "My grandson called from jail and needs $500 for bail"
    py learn/gemini/step1b_scam_review.py "Paying Jordan back for concert tickets"

Step 1 got back a sentence for a human to read. A program can't easily use a
sentence ("is this high risk?"), so here we ask for JSON with fields we choose.
"""

import json
import sys

from gemini_client import MODEL, call_gemini

# ---------------------------------------------------------------------------
# PART 1: The system instruction = Gemini's job description.
# It's sent with every request and tells the model WHO it is and HOW to behave.
# The user's words go separately, so they can't rewrite these rules.
# ---------------------------------------------------------------------------

SYSTEM_INSTRUCTION = """You are the scam check inside SwampTag, a banking app for older adults.
Before a money transfer, the customer explains in their own words why they are sending money.
Decide whether it matches a common scam: grandparent / family emergency, government or bank
impostor (IRS, police, tech support), romance scam, prize or lottery fee, or investment scam.
Signs include urgency, secrecy, gift cards or crypto, someone met only online, and paying to receive a prize.
Ordinary reasons (paying back a friend, splitting rent, a gift for someone they know in person) are low risk.
Write spokenWarning as 1-2 short, calm sentences a worried grandparent can understand when read aloud.
If the risk is low, spokenWarning should simply say the transfer looks fine."""

# ---------------------------------------------------------------------------
# PART 2: The response schema = the exact shape of JSON we want back.
# Gemini is forced to fill in these fields, with these types, every time.
# ---------------------------------------------------------------------------

RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "risk": {"type": "STRING", "enum": ["low", "medium", "high"]},  # only these 3 values allowed
        "scamType": {"type": "STRING", "description": "e.g. 'grandparent scam', or 'none'"},
        "reasons": {"type": "ARRAY", "items": {"type": "STRING"}, "description": "short red flags found"},
        "spokenWarning": {"type": "STRING"},
    },
    "required": ["risk", "scamType", "reasons", "spokenWarning"],
}


def review_transfer(explanation, amount, model=MODEL):
    # model=MODEL is a default: callers can pass another model (voice_check.py does when
    # one is busy), and old calls like review_transfer(text, 500) still work.
    body = {
        "systemInstruction": {"parts": [{"text": SYSTEM_INSTRUCTION}]},
        "contents": [{"parts": [{"text": f"Amount: ${amount}\nCustomer's explanation: {explanation}"}]}],
        "generationConfig": {
            "responseMimeType": "application/json",  # "reply with JSON, not prose"
            "responseSchema": RESPONSE_SCHEMA,       # "...and in exactly this shape"
            "temperature": 0,                        # same input → (almost) same answer
        },
    }
    result = call_gemini("POST", f"models/{model}:generateContent", body)
    text = result["candidates"][0]["content"]["parts"][0]["text"]  # still text, but JSON text
    return json.loads(text)  # turn JSON text into a Python dictionary


# ---------------------------------------------------------------------------
# PART 3: Use the answer like normal data.
#
# `if __name__ == "__main__":` means "only run this when the file is started
# directly". When another file does `from step1b_scam_review import review_transfer`,
# Python runs this whole file to load it, and without this line the demo below would
# run too (and call Gemini). Step 3 and voice_check.py import this file.
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    explanation = " ".join(sys.argv[1:]) or "My grandson called crying, he's in jail and needs bail. He said don't tell his parents."
    review = review_transfer(explanation, amount=500)

    print("Raw JSON from Gemini:")
    print(json.dumps(review, indent=2), "\n")

    # Because it's a dictionary now, code can make decisions with it:
    if review["risk"] == "high":
        print("🚨 PAUSE the transfer:", review["scamType"])
    elif review["risk"] == "medium":
        print("⚠️  Ask a follow-up question before sending.")
    else:
        print("✅ Looks fine, continue to the key tap.")
    print("Would be read aloud:", review["spokenWarning"])
