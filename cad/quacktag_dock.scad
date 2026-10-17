// QuackTag key dock: a slim case for the Feather RP2040 + RC522 key device.
// The key fob rests in a shallow pocket on top and gets a new code every 15 s.
//
// How it stays slim (about 67 x 71 x 27 mm):
//   - The RC522 hangs UPSIDE DOWN right under the lid, held by 4 snap corners.
//     Its antenna is ~4 mm under the fob, and its jumper plugs hang down into the box.
//   - The Feather lies on the floor next to it, pins up, USB-C out the right wall.
//   - Both sets of plugs share the same height, so nothing stacks.
//   - The top is smooth: a fob pocket over the antenna, and a hidden glow strip
//     (the lid is thinned from below) where the Feather's status light shines through.
//
// Parts: base, lid, fit_test, assembly. Open in OpenSCAD, pick `part`, F6, then
// File > Export > Export as STL. Prints with no supports. See cad/README.md.
//
// Coordinates: X = left -> right, Y = front -> back, Z = up. The RC522 is at the front.

/* [Part to render] */
part = "assembly"; // [assembly, base, lid, fit_test]

/* [RC522 (measure yours)] */
rc_l = 59.4;        // long side (2.34 in); the 8-pin header is on the LEFT short end
rc_w = 39.1;        // short side (1.54 in)
rc_t = 1.6;
rc_gap = 2.4;       // space between the lid and the RC522's back (its header pin tips)

/* [Feather RP2040] */
fe_l = 50.8;
fe_w = 22.86;
fe_t = 1.6;
fe_holes = [45.72, 17.78];  // mounting-hole spacing (2.54 mm in from each edge)
fe_peg_d = 2.2;             // peg into the 2.5 mm holes; +/-0.1 for a tighter/looser fit
fe_stand = 2.5;             // lifts the board over its solder tips
usb_cut = [12.5, 7.5];      // USB-C opening [width, height]
usb_h = 3.2;                // USB-C connector height above the board

/* [Jumper plugs] */
plug_h = 18.5;      // header plastic (2.5) + female plug (14) + wire bend (2)

/* [Key fob pocket] */
fob_l = 41;
fob_w = 32;
fob_r = 12;         // corner rounding (bigger = more teardrop-like)
fob_from_end = 24;  // pocket center, from the RC522's antenna end (the right end)
pocket_d = 0.8;     // pocket depth

/* [Case] */
wall = 2.0;
floor_t = 1.6;
lid_t = 1.8;
corner_r = 6;
fit = 0.15;         // lid-to-wall clearance
glow_t = 0.6;       // lid thickness left over the glow strip
label = "QuackTag";

/* [Hidden] */
$fn = 64;
c = 0.4;            // clearance around boards
bt = 1.2;           // snap-corner thickness
in_x = rc_l + 2 * (c + bt);
in_y = (bt + c) + rc_w + (c + bt) + 1.0 + fe_w + 0.6;
W = in_x + 2 * wall;
D = in_y + 2 * wall;
fe_top = floor_t + fe_stand + fe_t;            // top face of the Feather
Hl = max(fe_top + plug_h + 0.6,                // Feather plugs (pointing up) clear the lid
         floor_t + 0.8 + plug_h + rc_t + rc_gap); // RC522 plugs (pointing down) clear the floor
H = Hl + lid_t;                                // overall height
rc_x0 = wall + bt + c;
rc_y0 = wall + bt + c;
rc_back = Hl - rc_gap;                         // z of the RC522's back (it faces up)
fe_x1 = W - wall - 0.3;                        // USB-C end, at the right wall
fe_x0 = fe_x1 - fe_l;
fe_y0 = rc_y0 + rc_w + c + bt + 1.0;
fe_c = [fe_x0 + fe_l / 2, fe_y0 + fe_w / 2];
fob_c = [rc_x0 + rc_l - fob_from_end, rc_y0 + rc_w / 2];

echo(str("Dock size: ", W, " x ", D, " x ", H, " mm (", W / 25.4, " x ", D / 25.4, " x ", H / 25.4, " in)"));

// ---------- Helpers ----------

module rr(size, r) {  // rounded rectangle, corner at the origin
  offset(r = r) offset(delta = -r) square(size);
}

module rr_c(size, r) {  // rounded rectangle, centered
  offset(r = r) square([size[0] - 2 * r, size[1] - 2 * r], center = true);
}

// The outer shell outline with a 45-degree chamfer at the bottom (z=0) edge.
module chamfered(size, h, r, ch) {
  hull() {
    translate([0, 0, ch]) linear_extrude(h - ch) translate([0, 0]) rr(size, r);
    linear_extrude(ch) translate([ch, ch]) rr([size[0] - 2 * ch, size[1] - 2 * ch], r - ch);
  }
}

module nfc_icon(s) {  // a dot and three arcs, about s wide
  translate([-s * 0.35, 0]) {
    circle(d = s * 0.18);
    for (i = [1 : 3]) intersection() {
      difference() { circle(r = s * 0.22 * i + s * 0.045); circle(r = s * 0.22 * i - s * 0.045); }
      polygon([[0, 0], [s * 2, s * 2], [s * 2, -s * 2]]);
    }
  }
}

// ---------- Base ----------

function fe_holes_xy() = [for (i = [-1, 1], j = [-1, 1]) [fe_c[0] + i * fe_holes[0] / 2, fe_c[1] + j * fe_holes[1] / 2]];

module base() {
  difference() {
    chamfered([W, D], Hl, corner_r, 0.8);
    translate([wall, wall, floor_t]) linear_extrude(Hl) rr([in_x, in_y], corner_r - wall);
    // USB-C opening in the right wall
    translate([W - wall - 1, fe_c[1], fe_top + usb_h / 2]) rotate([0, 90, 0])
      linear_extrude(wall + 2) rr_c([usb_cut[1], usb_cut[0]], 2);
    // finger scoop on the front edge to lift the lid
    translate([W / 2, -1, Hl + 3]) rotate([-90, 0, 0]) scale([2.2, 1, 1]) cylinder(r = 4, h = wall + 2);
    // shallow seats for stick-on rubber feet
    for (x = [9, W - 9], y = [9, D - 9]) translate([x, y, -1]) cylinder(d = 8.4, h = 1.4);
  }
  // Feather standoffs with press-fit pegs
  for (p = fe_holes_xy()) translate([p[0], p[1], floor_t - 0.01]) {
    cylinder(d = 4.8, h = fe_stand + 0.01);
    translate([0, 0, fe_stand]) cylinder(d1 = fe_peg_d, d2 = fe_peg_d - 0.3, h = fe_t + 1.4);
  }
}

// ---------- Lid (prints top-down: smooth top on the bed) ----------

// One snap corner for the RC522, in lid coordinates (z goes DOWN from the lid's underside).
// sx/sy = -1/+1: which corner of the board.
module rc_corner(sx, sy) {
  h = rc_gap + rc_t + 1.2;
  leg = 6;
  mirror([sx > 0 ? 1 : 0, 0, 0]) mirror([0, sy > 0 ? 1 : 0, 0]) {
    // L walls just outside the board corner
    translate([-bt - c, -bt - c, 0]) cube([leg + bt + c, bt, h]);
    translate([-bt - c, -bt - c, 0]) cube([bt, leg + bt + c, h]);
    // pad the board's back rests on
    translate([-c, -c, 0]) cube([3.4, 3.4, rc_gap]);
    // snap nubs just past the board's front face: flat on the board side, ramped on the
    // open side so the board clicks in
    z0 = rc_gap + rc_t + 0.1;
    hull() {
      translate([leg / 2 - 1, -c - 0.01, z0]) cube([2, 0.45, 0.01]);
      translate([leg / 2 - 1, -c - 0.01, z0 + 1]) cube([2, 0.01, 0.01]);
    }
    hull() {
      translate([-c - 0.01, leg / 2 - 1, z0]) cube([0.45, 2, 0.01]);
      translate([-c - 0.01, leg / 2 - 1, z0 + 1]) cube([0.01, 2, 0.01]);
    }
  }
}

module lid() {
  // Built upside down: z = 0 is the lid's top face (on the print bed).
  ix = in_x - 2 * fit;
  iy = in_y - 2 * fit;
  difference() {
    // plate with a 45-degree chamfer on the top edge
    chamfered([W, D], lid_t, corner_r, 1.0);
    // fob pocket over the RC522 antenna (x mirrored because the lid is flipped)
    translate([W - fob_c[0], fob_c[1], -1]) linear_extrude(pocket_d + 1) rr_c([fob_l + 1.2, fob_w + 1.2], fob_r + 0.6);
    // small NFC mark in the pocket floor
    translate([W - fob_c[0], fob_c[1], pocket_d - 0.01]) linear_extrude(0.35) mirror([1, 0]) nfc_icon(12);
    // label over the Feather, debossed
    translate([W - fe_c[0], fe_c[1] + 5, -0.01]) linear_extrude(0.5)
      mirror([1, 0]) text(label, size = 5, halign = "center", valign = "center", font = "Liberation Sans:style=Bold");
    // glow strip: thinned from below, so the top stays smooth
    translate([W - fe_c[0], fe_c[1] - 3.5, glow_t]) linear_extrude(lid_t) rr_c([fe_l - 12, 4], 2);
  }
  // skirt that drops inside the walls (left out along the back wall, where the Feather's plugs are)
  translate([0, 0, lid_t - 0.01]) difference() {
    translate([wall + fit, wall + fit, 0]) linear_extrude(3) rr([ix, iy], corner_r - wall - fit);
    translate([wall + fit + 1.2, wall + fit + 1.2, -1]) linear_extrude(5) rr([ix - 2.4, iy - 2.4], max(0.5, corner_r - wall - fit - 1.2));
    // opening along the back wall, so the Feather's plugs (3V is ~9 mm from the right wall) fit
    translate([wall + 4, D - wall - 3, -1]) cube([W - 2 * wall - 8, 4, 5]);
  }
  // friction bumps on the skirt
  for (x = [W * 0.3, W * 0.7]) translate([x, wall + fit, lid_t + 1.8]) sphere(r = 0.35);
  for (x = [wall + fit, W - wall - fit]) translate([x, D * 0.3, lid_t + 1.8]) sphere(r = 0.35);
  // RC522 snap corners (mirrored in x like everything else on the flipped lid)
  for (sx = [-1, 1], sy = [-1, 1])
    translate([W - (sx < 0 ? rc_x0 : rc_x0 + rc_l), sy < 0 ? rc_y0 : rc_y0 + rc_w, lid_t - 0.01]) rc_corner(-sx, sy);
}

// ---------- Fit test (~20 min): Feather pegs, one RC522 corner pair, USB-C gauge ----------

module fit_test() {
  // Feather peg pattern on a thin frame
  translate([-fe_c[0] + fe_l / 2 + 3, -fe_c[1] + fe_w / 2 + 3, 0]) {
    difference() {
      translate([fe_c[0] - fe_l / 2 - 3, fe_c[1] - fe_w / 2 - 3, 0]) cube([fe_l + 6, fe_w + 6, 1.2]);
      translate([fe_c[0] - fe_l / 2 + 6, fe_c[1] - fe_w / 2 + 6, -1]) cube([fe_l - 12, fe_w - 12, 3]);
    }
    for (p = fe_holes_xy()) translate([p[0], p[1], 1.19]) {
      cylinder(d = 4.8, h = 1.5);
      translate([0, 0, 1.5]) cylinder(d1 = fe_peg_d, d2 = fe_peg_d - 0.3, h = fe_t + 1.4);
    }
  }
  // RC522 short end: two snap corners on a strip, the board's width apart.
  // The RC522 should click in and sit flat on the pads.
  translate([0, fe_w + 12, 0]) {
    cube([10, rc_w + 2 * (bt + c) + 4, 1.2]);
    translate([2 + bt + c, 2 + bt + c, 1.19]) {
      rc_corner(-1, -1);
      translate([0, rc_w, 0]) rc_corner(-1, 1);
    }
  }
  // USB-C opening gauge
  translate([16, fe_w + 12, 0]) difference() {
    cube([24, 16, wall]);
    translate([12, 8, -1]) linear_extrude(wall + 2) rr_c([usb_cut[0], usb_cut[1]], 2);
  }
}

// ---------- Assembly preview ----------

module assembly() {
  color("#2b3340") base();
  color("#f4f4f2") translate([W, 0, H]) rotate([0, 180, 0]) lid();  // undo the print flip
  // boards
  color("#1d4fa8") translate([rc_x0, rc_y0, rc_back - rc_t]) cube([rc_l, rc_w, rc_t]);
  color("#222") translate([fe_x0, fe_y0, fe_top - fe_t]) cube([fe_l, fe_w, fe_t]);
  // plugs: RC522 header (left end, hanging down) and Feather (pointing up)
  color("#111") translate([rc_x0 + 1, rc_y0 + rc_w / 2 - 10, rc_back - rc_t - plug_h + 2]) cube([2.6, 20, plug_h - 2]);
  // Feather plugs: 3V, GND, SCK, MO, MI on the long row (back), 10 and 9 on the short row (front)
  color("#111") for (x = [6.3, 11.4, 29.2, 31.7, 34.3]) translate([fe_x1 - x - 1.3, fe_y0 + fe_w - 2.5, fe_top]) cube([2.6, 2.5, plug_h - 2]);
  color("#111") for (x = [29.2, 31.7]) translate([fe_x1 - x - 1.3, fe_y0, fe_top]) cube([2.6, 2.5, plug_h - 2]);
  // the fob in its pocket
  color("#0b5fa5") translate([fob_c[0], fob_c[1], H - pocket_d + 0.1]) linear_extrude(4) rr_c([fob_l, fob_w], fob_r);
}

if (part == "base") base();
else if (part == "lid") lid();
else if (part == "fit_test") fit_test();
else if (part == "assembly") assembly();
