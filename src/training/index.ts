import type { ComponentType } from "react";
import MembershipForAFriend from "./membership-for-a-friend";
import WhatWeCanPost from "./what-we-can-post";

// Each training's pictures and steps, by slug (see lib/training/catalog.ts
// for its title, version and quiz).
export const TRAINING_CONTENT: Record<string, ComponentType> = {
  "membership-for-a-friend": MembershipForAFriend,
  "what-we-can-post": WhatWeCanPost,
};
