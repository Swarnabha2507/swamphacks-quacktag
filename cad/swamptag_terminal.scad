// SwampTag phone terminal: card-scanner case for a Google Pixel 6a (parametric, no libraries)
//
// Looks like a countertop card terminal: a rounded white wedge with the phone as the screen.
//   - The Pixel lies face-up in PORTRAIT, UPSIDE DOWN, so its NFC spot (near the camera,
//     at the phone's top edge) sits right above the key slot at the front.
//     The terminal page (website/terminal.html) turns its picture right side up.
//   - The key slot runs parallel to the screen, under the phone, and stops under the NFC spot.
//     It takes the key fob or a card. Hold the key in for a second while the phone reads it.
//   - USB-C (the phone's bottom edge) is at the top of the screen; the cable leaves
//     through a notch over the top-back corner.
//
// Parts: body (white), tray (the screen frame the phone sits in), fit_test, assembly.
// Open in OpenSCAD, set `part`, press F6, then File → Export → Export as STL.
// Sized for the Prusa CORE One+ (250 × 220 × 270 mm). See cad/README.md.
//
// Coordinates: X = left→right, Y = front→back, Z = up. The customer stands at the front (Y = 0).
// "On the face" coordinates (on_face): x = X, v = distance up the sloped face from its
// front edge, z = out of the face (negative = into the case).

/* [Part to render] */
part = "assembly"; // [assembly, body, tray, fit_test]

/* [Pixel 6a: measure yours] */
phone_l = 152.2;       // length (top edge to bottom edge)
phone_w = 71.8;        // width
phone_t = 8.9;         // thickness (without the camera bar)
phone_r = 8;           // corner radius seen from the front
cam_from_top = 8;      // camera bar starts this far from the phone's top edge
cam_len = 22;          // camera bar height (along the phone's length)
cam_h = 1.6;           // how far the camera bar sticks out of the back
nfc_from_top = 45;     // strongest NFC read, measured from the top edge (NFC Tools app)
btn_from = 35;         // side buttons start this far from the top edge...
btn_to = 100;          // ...and end here

/* [Key slot] */
slot_w = 58;           // fits a 54 mm card or a key fob
slot_h = 7.5;          // fits a fob up to about 6.5 mm thick
slot_past_nfc = 14;    // the slot keeps going this far past the NFC spot

/* [Case] */
tilt = 30;             // screen angle from horizontal
H_f = 30;              // height at the front edge
fit = 0.4;             // clearance around the phone
tray_fit = 0.3;        // clearance between the tray and the body
wall = 2.4;
body_r = 8;            // rounding of the body's edges
tray_side = 7;         // frame width beside the phone
tray_bottom = 5;       // frame below the phone (front, above the slot)
tray_top = 12;         // frame above the phone (back, where the cable leaves)
front_m = 6;           // flat face in front of the tray
back_m = 18;           // flat face behind the tray (room for the rounded back edge)
side_m = 5;            // body edge beside the tray
flange_t = 2.5;        // tray rim that sits flush in the face
flange_w = 3;
pocket_depth = 7;      // phone sinks this deep (it sticks out ~2 mm so it's easy to grab)
tray_floor = 2.4;      // floor between the phone and the slot
cable_w = 16;          // USB-C cable notch width
btn_relief = 1.5;      // groove so the side buttons don't get pressed

/* [Hidden] */
$fn = 64;
PW = phone_w + 2 * fit;                     // pocket width
PL = phone_l + 2 * fit;                     // pocket length
Tw = PW + 2 * tray_side;                    // tray width
Tl = tray_bottom + PL + tray_top;           // tray length (along the face)
W = Tw + 2 * side_m;                        // body width
Lf = front_m + Tl + back_m;                 // face length
D = Lf * cos(tilt);                         // body depth
H_b = H_f + Lf * sin(tilt);                 // height at the back
cx = W / 2;
tray_depth = pocket_depth + tray_floor;
pv0 = front_m + tray_bottom;                // pocket starts here (the phone's TOP edge)
v_nfc = pv0 + fit + nfc_from_top;           // NFC spot
v_end = v_nfc + slot_past_nfc;              // end of the slot

// ---------- Helpers ----------

module on_face() {
  translate([0, 0, H_f]) rotate([tilt, 0, 0]) children();
}

module rrect(size, h, r = 3) {
  linear_extrude(h) offset(r = r) square([size[0] - 2 * r, size[1] - 2 * r], center = true);
}

// Side profile (Y, Z) with rounded top edges and a flat, sharp-edged bottom.
module profile(inset = 0) {
  offset(delta = -inset) union() {
    offset(r = body_r) offset(delta = -body_r) polygon([[0, 0], [D, 0], [D, H_b], [0, H_f]]);
    square([D, H_f / 2]);
  }
}

module body_solid(inset = 0) {
  intersection() {
    translate([inset, 0, 0]) rotate([90, 0, 90]) linear_extrude(W - 2 * inset) profile(inset);
    translate([0, 0, -1]) linear_extrude(H_b + 2) offset(r = body_r) offset(delta = -body_r)
      translate([inset, inset]) square([W - 2 * inset, D - 2 * inset]);
  }
}

// Everything under the plane "z = zl" in face coordinates.
module below_face(zl) {
  on_face() translate([-1, -400, zl - 600]) cube([W + 2, 1000, 600]);
}

// ---------- Tray (built in face coordinates: top surface at z = 0) ----------

module tray_local() {
  difference() {
    union() {
      translate([cx, front_m + Tl / 2, -flange_t]) rrect([Tw, Tl], flange_t, 6);
      translate([cx, front_m + Tl / 2, -tray_depth])
        rrect([Tw - 2 * flange_w, Tl - 2 * flange_w], tray_depth - flange_t + 0.01, 4);
    }
    // phone pocket
    translate([cx, pv0 + PL / 2, -pocket_depth]) rrect([PW, PL], pocket_depth + 1, phone_r + fit);
    // camera bar channel (the phone's top edge is at the front)
    translate([cx - PW / 2 + 3, pv0 + fit + cam_from_top - 1, -pocket_depth - cam_h - 0.4])
      cube([PW - 6, cam_len + 2, cam_h + 0.5]);
    // side buttons: phone is upside down, so they're on the left
    translate([cx - PW / 2 - btn_relief, pv0 + fit + btn_from, -pocket_depth])
      cube([btn_relief + 1, btn_to - btn_from, pocket_depth + 1]);
    // finger scoops to lift the phone out
    for (s = [-1, 1]) translate([cx + s * PW / 2, pv0 + PL * 0.55, -pocket_depth + 2]) cylinder(r = 10, h = 20);
    // USB-C cable notch at the phone's bottom edge (top of the screen)
    translate([cx - cable_w / 2, pv0 + PL - 2, -tray_depth - 1]) cube([cable_w, Tl, tray_depth + 2]);
  }
}

// ---------- Body ----------

module tunnel_cut() {
  on_face() translate([cx - slot_w / 2, -60, -tray_depth - slot_h]) cube([slot_w, 60 + v_end, slot_h + 0.01]);
}

// Solid block under the slot: holds the slot floor and walls and supports the tray.
module tunnel_block() {
  intersection() {
    body_solid();
    translate([cx - slot_w / 2 - wall, -1, -1]) cube([slot_w + 2 * wall, D + 2, H_b + 2]);
    on_face() translate([-1, -400, -600]) cube([W + 2, 400 + v_end + wall, 1200]);
    union() {
      below_face(-tray_depth);
      // in front of the tray, fill up to the face so the slot has a roof there too
      on_face() translate([-1, -400, -tray_depth - 1]) cube([W + 2, 400 + front_m + flange_w - tray_fit, tray_depth + 2]);
    }
  }
}

module body() {
  difference() {
    union() {
      difference() {
        body_solid();
        body_solid(wall);
      }
      tunnel_block();
    }
    // opening for the tray's lower part, and the recess for its rim
    on_face() translate([cx, front_m + Tl / 2, -tray_depth])
      rrect([Tw - 2 * flange_w + 2 * tray_fit, Tl - 2 * flange_w + 2 * tray_fit], tray_depth + 1, 4 + tray_fit);
    on_face() translate([cx, front_m + Tl / 2, -flange_t])
      rrect([Tw + 2 * tray_fit, Tl + 2 * tray_fit], flange_t + 1, 6 + tray_fit);
    tunnel_cut();
    // cable notch out over the top-back corner
    on_face() translate([cx - cable_w / 2, pv0 + PL - 2, -tray_depth - 1]) cube([cable_w, Lf, tray_depth + 30]);
    // wordmark on the back
    translate([cx, D - 0.8, H_b * 0.42]) rotate([0, 0, 180]) rotate([90, 0, 0])
      linear_extrude(2) text("SwampTag", size = 10, halign = "center", font = "Liberation Sans:style=Bold");
  }
}

// ---------- Fit test (~15 min) ----------

module fit_test() {
  // 1. The phone's top end: full pocket width, corners, camera channel and pocket depth
  translate([0, -(pv0 - 3), tray_depth]) intersection() {
    tray_local();
    translate([-1, pv0 - 3, -50]) cube([W + 2, 42, 100]);
  }
  // 2. Slot gauge: your key and a card should slide through
  translate([W + 8, 0, 0]) difference() {
    cube([slot_w + 12, 22, 3]);
    translate([6, 22 / 2 - slot_h / 2, -1]) cube([slot_w, slot_h, 5]);
  }
}

// ---------- Assembly preview ----------

module assembly() {
  color("white") body();
  color("#3a4048") on_face() tray_local();
  // phone (upside down: its top edge, with the camera, is at the front)
  color("#111") on_face() translate([cx, pv0 + PL / 2, -pocket_depth]) rrect([phone_w, phone_l], phone_t, phone_r);
  color("#2b6cb0") on_face() translate([cx, pv0 + PL / 2, -pocket_depth + phone_t]) rrect([phone_w - 4, phone_l - 6], 0.2, phone_r - 2);
  // a card halfway into the slot
  color("#1d4fa8") on_face() translate([cx - 27, v_end - 85.6 + 2, -tray_depth - slot_h + 0.3]) cube([54, 85.6, 0.8]);
}

if (part == "body") body();
else if (part == "tray") translate([0, 0, tray_depth]) tray_local();
else if (part == "fit_test") fit_test();
else assembly();
