// SwampTag card reader enclosure (parametric, no libraries)
//
// An angled "card terminal" for the Arduino UNO R4 WiFi + RC522 RFID reader:
//   - base tray: the R4 presses onto printed pegs, and USB-C exits the back wall
//   - sloped lid: RC522 clipped under a thin "TAP HERE" zone, plus a window
//     (with a light tunnel) over the R4's LED matrix so ✓ / ✗ show through
//   - diffuser: thin white plate that clips into the window from inside
//
// How to use: open in OpenSCAD, set `part`, press F6 (Render),
// then File → Export → Export as STL. Repeat for each part.
// Measure your boards first. See cad/README.md.
//
// Coordinates: X = left→right, Y = front→back, Z = up. The user sits at the front (Y = 0).

/* [Part to render] */
part = "assembly"; // [assembly, base, lid, diffuser, fit_test]

/* [UNO R4 WiFi: measure yours] */
// Hold the board components-up with the USB-C edge on the LEFT.
// x = mm from that left edge, y = mm from the BOTTOM edge (the POWER / ANALOG header edge).
uno_l = 68.6;                 // board length (left to right)
uno_w = 53.3;                 // board width (bottom to top)
pcb_t = 1.6;
uno_holes = [[14.0, 2.5], [15.3, 50.7], [66.1, 7.6], [66.1, 35.5]]; // standard Uno holes [x, y]
usb_center_y = 38.0;          // y of the USB-C connector's center
usb_h = 3.2;                  // USB-C receptacle height above the board
usb_cut = [13.5, 9.0];        // wall opening for the plug [width, height]
matrix_center = [41.0, 26.0]; // LED matrix center [x, y]
matrix_size = [26.0, 18.0];   // LED matrix size [along x, along y]

/* [RC522 reader: measure yours] */
rc_w = 39.0;        // short side (the side with the 8-pin header)
rc_l = 60.0;        // long side
rc_t = 1.6;
rc_gap = 4.0;       // space between the tap zone and the board (room for parts or pins)
rc_header_w = 30.0; // opening in the clip frame for the header and wires

/* [Shell] */
W = 112;            // outer width
D = 84;             // outer depth
H_f = 36;           // outer height at the front edge
slope = 12;         // top tilt toward the user, in degrees
base_h = 20;        // height where the lid meets the base
wall = 2.4;
floor_t = 2.0;
top_t = 2.4;        // lid top thickness
tap_t = 1.2;        // thinner top over the RC522, so the tag reads more easily
standoff_h = 5;
standoff_d = 6;
peg_d = 2.8;        // press-fit peg for the 3.2 mm board holes
fit = 0.2;          // lid-to-base clearance
lip_h = 4;
lip_t = 1.6;
board_gap_back = 2.5; // R4 edge to back wall (the barrel jack sticks out a little)
board_gap_side = 2.0;
chimney_gap = 6;    // light tunnel stops this far above the R4
dif_t = 0.8;        // diffuser thickness
dif_m = 2.5;        // diffuser overlap around the window
deboss = 0.6;       // depth of the wordmark on the lid

/* [Hidden] */
$fn = 48;
H_b = H_f + D * tan(slope);             // outer height at the back edge
ox = wall + board_gap_side;             // R4 left edge (world X)
oy = D - wall - board_gap_back - uno_l; // R4 front edge (world Y)
board_z = floor_t + standoff_h;         // underside of the R4
rc_x = ox + uno_w + 8;                  // RC522 left edge (world X)
rc_y = (D - rc_l) / 2;                  // RC522 front edge (world Y)

function z_top(y) = H_f + y * tan(slope); // outer top surface height at depth y
function v_of(y) = y / cos(slope);        // distance along the sloped top from the front edge
zf_in = z_top(wall) - top_t / cos(slope);
zb_in = z_top(D - wall) - top_t / cos(slope);

// R4 board coordinates → world [X, Y]. The USB-C edge faces the back wall.
function bpos(p) = [ox + p[1], oy + uno_l - p[0]];

mc = bpos(matrix_center);                       // LED matrix center (world)
win = [matrix_size[1] + 4, matrix_size[0] + 4]; // window size [X, along slope]
dif = [win[0] + 2 * dif_m, win[1] + 2 * dif_m]; // diffuser size

// ---------- Helpers ----------

// Box with a sloped top: front edge at height zf, back edge at height zb.
module wedge(x0, y0, w, d, z0, zf, zb) {
  polyhedron(
    points = [[x0, y0, z0], [x0 + w, y0, z0], [x0 + w, y0 + d, z0], [x0, y0 + d, z0],
              [x0, y0, zf], [x0 + w, y0, zf], [x0 + w, y0 + d, zb], [x0, y0 + d, zb]],
    faces = [[0, 1, 2, 3], [4, 5, 1, 0], [7, 6, 5, 4], [5, 6, 2, 1], [6, 7, 3, 2], [7, 4, 0, 3]]);
}

// Work on the lid's sloped top. Local x = world X, local y = distance up the slope,
// local z = out of the top surface (negative = into the lid).
module on_top() {
  translate([0, 0, H_f]) rotate([slope, 0, 0]) children();
}

module rrect(size, h, r = 1.5) {
  linear_extrude(h) offset(r = r) square([size[0] - 2 * r, size[1] - 2 * r], center = true);
}

module ring(x0, t, z0, h) {
  difference() {
    translate([x0, x0, z0]) cube([W - 2 * x0, D - 2 * x0, h]);
    translate([x0 + t, x0 + t, z0 - 1]) cube([W - 2 * (x0 + t), D - 2 * (x0 + t), h + 2]);
  }
}

// Contactless symbol: a dot plus three right-facing arcs.
module contactless(s) {
  circle(d = s * 0.22);
  for (i = [1 : 3]) {
    intersection() {
      difference() {
        circle(r = s * 0.28 * i);
        circle(r = s * 0.28 * i - 1.6);
      }
      polygon([[0, 0], [s * 2, s * 1.6], [s * 2, -s * 1.6]]);
    }
  }
}

module shell() {
  difference() {
    wedge(0, 0, W, D, 0, H_f, H_b);
    wedge(wall, wall, W - 2 * wall, D - 2 * wall, floor_t, zf_in, zb_in);
  }
}

// ---------- Base ----------

module standoff(h) {
  cylinder(d = standoff_d, h = h);
  translate([0, 0, h]) cylinder(d1 = peg_d, d2 = peg_d - 0.4, h = pcb_t + 1.6);
}

module usb_cutout() {
  translate([ox + usb_center_y, D - wall - 1, board_z + pcb_t + usb_h / 2])
    rotate([-90, 0, 0]) rrect(usb_cut, wall + 2);
}

module snap_dimples() {
  for (s = [-1, 1]) translate([W / 2 + s * (W / 2 - wall), D / 2, base_h - lip_h / 2]) sphere(r = 1.1);
}

module base() {
  difference() {
    intersection() {
      shell();
      translate([-1, -1, -1]) cube([W + 2, D + 2, base_h + 1]);
    }
    usb_cutout();
    snap_dimples();
  }
  for (p = uno_holes) translate([bpos(p)[0], bpos(p)[1], 0]) standoff(board_z);
}

// ---------- Lid ----------

// RC522 clip frame, built with its top at local z = 0 and hanging down (negative z).
// The board sits on four corner posts and snaps past two ramped lips.
module rc_frame() {
  c = 0.4;                         // clearance around the board
  t = 1.6;                         // frame wall
  hgt = rc_gap + rc_t + 1.4;
  seat = rc_gap + rc_t + 0.25;     // where the lips catch the board
  difference() {
    translate([-c / 2 - t, -c / 2 - t, -hgt]) cube([rc_w + c + 2 * t, rc_l + c + 2 * t, hgt]);
    translate([-c / 2, -c / 2, -hgt - 1]) cube([rc_w + c, rc_l + c, hgt + 2]);
    translate([(rc_w - rc_header_w) / 2, rc_l - 1, -hgt - 1]) cube([rc_header_w, t + 5, hgt + 2]);
  }
  for (p = [[0, 0], [rc_w - 3, 0], [0, rc_l - 3], [rc_w - 3, rc_l - 3]])
    translate([p[0], p[1], -rc_gap]) cube([3, 3, rc_gap]);
  translate([-c / 2, rc_l / 2 - 6, 0]) snap_lip(seat, hgt);
  translate([rc_w + c / 2, rc_l / 2 - 6, 0]) mirror([1, 0, 0]) snap_lip(seat, hgt);
}

// Ramp that is thin at the opening and 0.6 mm deep where the board seats.
module snap_lip(seat, hgt) {
  hull() {
    translate([0, 0, -seat - 0.01]) cube([0.6, 12, 0.01]);
    translate([0, 0, -hgt]) cube([0.05, 12, 0.01]);
  }
}

module window_cut() {
  on_top() translate([mc[0] - win[0] / 2, v_of(mc[1]) - win[1] / 2, -top_t - 1]) cube([win[0], win[1], top_t + 2]);
}

module diffuser_recess() {
  on_top() translate([mc[0] - dif[0] / 2, v_of(mc[1]) - dif[1] / 2, -top_t - 1]) cube([dif[0], dif[1], 1 + dif_t]);
}

module tap_pocket() {
  on_top() translate([rc_x - 2, v_of(rc_y) - 2, -top_t - 1]) cube([rc_w + 4, rc_l + 4, 1 + top_t - tap_t]);
}

module top_marks() {
  on_top() {
    translate([8, 8, -deboss]) linear_extrude(deboss + 1)
      text("SwampTag", size = 7, font = "Liberation Sans:style=Bold");
    translate([rc_x + rc_w / 2 - 8, v_of(rc_y + rc_l / 2) + 4, -0.4]) linear_extrude(1.5) contactless(12);
    translate([rc_x + rc_w / 2, v_of(rc_y) + 6, -0.4]) linear_extrude(1.5)
      text("TAP HERE", size = 4.5, halign = "center", font = "Liberation Sans:style=Bold");
  }
}

// Vertical light tunnel from the LED matrix up to the window, so the light doesn't spill.
module chimney() {
  ci = [dif[0] + 1, dif[1] * cos(slope) + 2];
  zb = board_z + pcb_t + chimney_gap;
  intersection() {
    wedge(wall, wall, W - 2 * wall, D - 2 * wall, 0, zf_in + 0.01, zb_in + 0.01);
    translate([mc[0], mc[1], zb]) difference() {
      translate([-ci[0] / 2 - 1.2, -ci[1] / 2 - 1.2, 0]) cube([ci[0] + 2.4, ci[1] + 2.4, 100]);
      translate([-ci[0] / 2, -ci[1] / 2, -1]) cube([ci[0], ci[1], 102]);
    }
  }
}

module lip() {
  ring(wall + fit, lip_t, base_h - lip_h, lip_h + 0.01);   // slides inside the base walls
  ring(wall - 0.01, fit + lip_t + 0.01, base_h, 2);         // joins the lip to the lid walls
  for (s = [-1, 1]) translate([W / 2 + s * (W / 2 - wall - fit - 0.4), D / 2, base_h - lip_h / 2]) sphere(r = 1);
}

module lid() {
  difference() {
    intersection() {
      shell();
      translate([-1, -1, base_h]) cube([W + 2, D + 2, H_b + 10]);
    }
    window_cut();
    diffuser_recess();
    tap_pocket();
    top_marks();
  }
  lip();
  on_top() translate([rc_x, v_of(rc_y), -tap_t]) rc_frame();
  chimney();
}

// Lid flipped so the sloped top lies flat on the print bed.
module lid_print() {
  translate([0, 0, H_f * cos(slope)]) rotate([180 - slope, 0, 0]) lid();
}

// ---------- Diffuser ----------

module diffuser() {
  cube([dif[0] - 0.3, dif[1] - 0.3, dif_t]);
}

// ---------- Fit test (~25 min) ----------

module peg_plate() {
  difference() {
    translate([ox - 1.5, oy - 1.5, 0]) cube([uno_w + 3, uno_l + 3, 1.2]);
    translate([ox + 4, oy + 4, -1]) cube([uno_w - 8, uno_l - 8, 3]);
  }
  for (p = uno_holes) translate([bpos(p)[0], bpos(p)[1], 0]) standoff(3);
}

module fit_test() {
  translate([2 - ox + 1.5, 2 - oy + 1.5, 0]) peg_plate();           // R4 pegs
  translate([uno_w + 12, 0, 0]) difference() {                     // USB-C opening
    cube([30, 20, wall]);
    translate([15, 10, -1]) rrect(usb_cut, wall + 2);
  }
  translate([uno_w + 12, 26, 0]) {                                 // RC522 clip frame
    cube([rc_w + 8, rc_l + 8, 1.2]);
    translate([4, 4, 1.2]) mirror([0, 0, 1]) rc_frame();
  }
}

// ---------- Assembly preview ----------

module assembly() {
  color("#13294b") base();
  color("#004977", 0.55) lid();
  color("#2e7d4f") translate([ox, oy, board_z]) cube([uno_w, uno_l, pcb_t]);
  color("#1d4fa8") on_top() translate([rc_x, v_of(rc_y), -tap_t - rc_gap - rc_t]) cube([rc_w, rc_l, rc_t]);
  color("white") on_top()
    translate([mc[0] - dif[0] / 2 + 0.15, v_of(mc[1]) - dif[1] / 2 + 0.15, -top_t]) cube([dif[0] - 0.3, dif[1] - 0.3, dif_t]);
}

if (part == "base") base();
else if (part == "lid") lid_print();
else if (part == "diffuser") diffuser();
else if (part == "fit_test") fit_test();
else assembly();
