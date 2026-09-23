// An error whose message was written for the person using the app (not a
// raw DB/network message), so it's safe to show them. Server Actions should
// catch these and *return* the message: Next.js replaces a thrown error's
// message with a generic "Minified React error #441" in production.
export class UserFacingError extends Error {}
