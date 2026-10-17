// SwampTag key dock: small case for the Adafruit Feather RP2040 + RC522 RFID reader
// + the 7 female-to-female jumper wires between them (parametric, no libraries).
//
//   - Both boards sit side by side just under a flat, flush lid. Their header pins point
//     DOWN, so the space underneath is a wire bay for the female plugs and the jumpers.
//   - A comb on the floor keeps the 7 jumpers in order, and two clips hold the slack.
//   - A raised cradle on the lid holds the key fob right over the RC522's antenna,
//     so it can be rewritten while it rests there.
//   - The Feather's USB-C exits through the left wall. No screws, no print supports.
//
// Parts: base, lid, fit_test, assembly. Open in OpenSCAD, set `part`, press F6,
// then File → Export → Export as STL. Sized for the Prusa CORE One+. See cad/README.md.
//
// Coordinates: X = left→right (long side), Y = front→back, Z = up.

/* [Part to render] */
part = "assembly"; // [assembly, base, lid, fit_test]

/* [Adafruit Feather RP2040: measure yours] */
fe_l = 50.8;            // length (USB-C end to far end)
fe_w = 22.86;           // width
fe_t = 1.6;
fe_holes = [45.72, 17.78]; // mounting-hole spacing (holes are 2.54 mm in from each edge)
fe_top_clear = 6.5;     // tallest part on top (the battery connector) + a little room
usb_cut = [12, 7.5];    // wall opening for the USB-C plug [width, height]
usb_h = 3.2;            // USB-C connector height above the board

/* [RC522: measure yours] */
rc_l = 59.4;            // long side, 2.34 in (the 8-pin header is on the RIGHT short end)
rc_w = 39.1;            // short side, 1.54 in
rc_t = 1.6;
rc_top_clear = 4.5;     // tallest part on top of the RC522 (crystal) + a little room

/* [Wires] */
under_clear = 17;       // room under the boards: 2.5 mm header plastic + 14 mm female plug + 0.5

/* [Key fob cradle] */
fob_l = 41;             // fob length
fob_w = 32;             // fob width
fob_r = 12;             // corner rounding of the cradle (bigger = more teardrop-like)
fob_from_left = 26;     // cradle center, from the RC522's left (non-header) end
cradle_h = 1.6;         // height of the cradle rim
cradle_gap = 16;        // opening at the front of the cradle to slide the fob out

/* [Case] */
wall = 2.4;
floor_t = 1.6;
lid_t = 1.8;
gap = 0.6;              // clearance around each board
mid_gap = 5;            // space between the two boards
corner_r = 4;
lid_fit = 0.15;         // lid-to-rim clearance
text_label = "SwampTag KEY";

/* [Hidden] */
$fn = 48;
in_x = rc_l + 2 * gap;
in_y = rc_w + mid_gap + fe_w + 2 * gap;
W = in_x + 2 * wall;
D = in_y + 2 * wall;
board_space = max(fe_top_clear + fe_t, rc_top_clear + rc_t);
H = floor_t + under_clear + board_space + lid_t;
lid_z = H - lid_t;                        // underside of the lid
rc_x0 = wall + gap;
rc_y0 = wall + gap;
rc_top = lid_z - rc_top_clear;            // top of the RC522 board
fe_x0 = wall + 1.2;                       // USB-C end close to the left wall
fe_y0 = rc_y0 + rc_w + mid_gap;
fe_top = lid_z - fe_top_clear;            // top of the Feather board
rebate = wall / 2;                        // the lid sinks into the top of the walls

// ---------- Helpers ----------

module rbox(size, r) {
  // Box with rounded vertical edges, corner at the origin.
  linear_extrude(size[2]) offset(r = r) offset(delta = -r) square([size[0], size[1]]);
}

module rrect_c(size, h, r) {
  linear_extrude(h) offset(r = r) square([size[0] - 2 * r, size[1] - 2 * r], center = true);
}

function fe_holes_xy() = [
  for (i = [-1, 1], j = [-1, 1])
    [fe_x0 + fe_l / 2 + i * fe_holes[0] / 2, fe_y0 + fe_w / 2 + j * fe_holes[1] / 2]
];

module feather_standoff(h) {
  cylinder(d = 4.6, h = h);
  translate([0, 0, h]) cylinder(d1 = 2.2, d2 = 1.9, h = fe_t + 1.2); // press-fit peg
}

// Corner post with an L-shaped lip that keeps the RC522 from sliding.
module rc_corner(sx, sy, h) {
  // sx, sy = +1/-1: which corner (lips go on the outside of the board edge)
  translate([sx > 0 ? -3.5 : 0, sy > 0 ? -3.5 : 0, 0]) cube([3.5, 3.5, h]);
  translate([sx > 0 ? 0 : -1.2, sy > 0 ? -3.5 : -1.2, 0]) cube([1.2, 4.7, h + rc_t + 1]);
  translate([sx > 0 ? -3.5 : -1.2, sy > 0 ? 0 : -1.2, 0]) cube([4.7, 1.2, h + rc_t + 1]);
}

// ---------- Base ----------

module wire_comb() {
  // A low rib between the boards with 7 slots, one per jumper.
  slots = 7; pitch = 3.4; slot_w = 2.2;
  len = slots * pitch + 4;
  x0 = rc_x0 + rc_l - 6 - len;            // near the RC522's header end
  y0 = rc_y0 + rc_w + mid_gap / 2 - 1.5;
  translate([x0, y0, floor_t - 0.01]) difference() {
    cube([len, 3, 9]);
    for (i = [0 : slots - 1]) translate([2 + pitch / 2 + i * pitch - slot_w / 2, -1, 3]) cube([slot_w, 5, 7]);
  }
}

module wire_clip(x, y) {
  // Small arch on the floor to tuck a loop of spare wire under.
  translate([x, y, floor_t - 0.01]) difference() {
    cube([8, 3, 7]);
    translate([1.6, -1, -1]) cube([4.8, 5, 6]);
  }
}

module base() {
  difference() {
    rbox([W, D, H], corner_r);
    // inside
    translate([wall, wall, floor_t]) rbox([in_x, in_y, H], corner_r - wall + 1);
    // rebate for the flush lid
    translate([wall - rebate, wall - rebate, lid_z]) rbox([in_x + 2 * rebate, in_y + 2 * rebate, lid_t + 1], corner_r - rebate);
    // finger notch to lift the lid (front edge)
    translate([W / 2, -1, H]) rotate([-90, 0, 0]) cylinder(r = 6, h = wall + 2);
    // USB-C opening in the left wall, lined up with the Feather's connector
    translate([-1, fe_y0 + fe_w / 2, fe_top + usb_h / 2]) rotate([0, 90, 0]) rrect_c([usb_cut[1], usb_cut[0]], wall + 2, 1.5);
  }
  // Feather standoffs (pegs go into its 4 corner holes)
  for (p = fe_holes_xy()) translate([p[0], p[1], floor_t - 0.01]) feather_standoff(fe_top - fe_t - floor_t + 0.01);
  // RC522 corner posts
  rc_h = rc_top - rc_t - floor_t + 0.01;
  for (sx = [-1, 1], sy = [-1, 1])
    translate([sx < 0 ? rc_x0 : rc_x0 + rc_l, sy < 0 ? rc_y0 : rc_y0 + rc_w, floor_t - 0.01]) rc_corner(sx, sy, rc_h);
  // wire management
  wire_comb();
  wire_clip(wall + 6, rc_y0 + rc_w + mid_gap / 2 - 1.5);
  wire_clip(wall + 18, rc_y0 + rc_w + mid_gap / 2 - 1.5);
  // two small bumps hold the lid in its rebate
  for (s = [-1, 1]) translate([W / 2 + s * W / 4, wall - rebate - lid_fit, lid_z + lid_t * 0.55]) sphere(r = 0.5);
  for (s = [-1, 1]) translate([W / 2 + s * W / 4, D - wall + rebate + lid_fit, lid_z + lid_t * 0.55]) sphere(r = 0.5);
}

// ---------- Lid (flat; everything on its top, so it prints with no supports) ----------

fob_c = [rc_x0 + fob_from_left, rc_y0 + rc_w / 2];

module cradle() {
  translate([fob_c[0], fob_c[1], lid_t - 0.01]) difference() {
    rrect_c([fob_l + 2 * 1.2 + 1, fob_w + 2 * 1.2 + 1], cradle_h, fob_r + 1.2);
    translate([0, 0, -1]) rrect_c([fob_l + 1, fob_w + 1], cradle_h + 2, fob_r);
    translate([-cradle_gap / 2, -fob_w, -1]) cube([cradle_gap, fob_w / 2, cradle_h + 2]); // front opening
  }
}

module lid_flat() {
  difference() {
    translate([wall - rebate + lid_fit, wall - rebate + lid_fit, 0])
      rbox([in_x + 2 * rebate - 2 * lid_fit, in_y + 2 * rebate - 2 * lid_fit, lid_t], corner_r - rebate);
    // label over the Feather
    translate([fe_x0 + fe_l / 2, fe_y0 + fe_w / 2, lid_t - 0.6]) linear_extrude(1)
      text(text_label, size = 5, halign = "center", valign = "center", font = "Liberation Sans:style=Bold");
  }
  cradle();
}

// ---------- Fit test (~15 min) ----------

module fit_test() {
  // 1. Feather peg pattern on short standoffs
  translate([-fe_x0 + 4, -fe_y0 + 4, 0]) {
    translate([fe_x0 - 2, fe_y0 - 2, 0]) cube([fe_l + 4, fe_w + 4, 1.2]);
    for (p = fe_holes_xy()) translate([p[0], p[1], 1.19]) feather_standoff(2);
  }
  // 2. RC522 corner posts on a frame
  translate([fe_l + 16, 0, 0]) {
    difference() {
      cube([rc_l + 2 * gap + 6, rc_w + 2 * gap + 6, 1.2]);
      translate([8, 8, -1]) cube([rc_l + 2 * gap - 10, rc_w + 2 * gap - 10, 3]);
    }
    for (sx = [-1, 1], sy = [-1, 1])
      translate([3 + gap + (sx < 0 ? 0 : rc_l), 3 + gap + (sy < 0 ? 0 : rc_w), 1.19]) rc_corner(sx, sy, 2);
  }
  // 3. USB-C opening gauge
  translate([0, fe_w + 14, 0]) difference() {
    cube([24, 16, wall]);
    translate([12, 8, -1]) rrect_c([usb_cut[0], usb_cut[1]], wall + 2, 1.5);
  }
}

// ---------- Assembly preview ----------

module assembly() {
  color("white") base();
  color("#3a4048", 0.85) translate([0, 0, lid_z]) lid_flat();
  color("#1d4fa8") translate([rc_x0, rc_y0, rc_top - rc_t]) cube([rc_l, rc_w, rc_t]);       // RC522
  color("#222") translate([fe_x0, fe_y0, fe_top - fe_t]) cube([fe_l, fe_w, fe_t]);          // Feather
  color("#0b5fa5") translate([fob_c[0], fob_c[1], H + 0.2]) rrect_c([fob_l - 1, fob_w - 1], 5, fob_r); // fob
}

if (part == "base") base();
else if (part == "lid") lid_flat();
else if (part == "fit_test") fit_test();
else assembly();
