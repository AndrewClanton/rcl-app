// The back office's remembered-on-this-device settings that the server
// needs to see too, so the page arrives already laid out that way. Plain
// data, no browser or server code, so both sides can read it.

// "rail": the sidebar folded down to the slim strip; "full" or unset: the
// whole menu down the side (iPad and up; a phone always has the drawer).
export const RAIL_COOKIE = "rcl_bo_menu";
