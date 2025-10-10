// We are temporarily removing all the old imports and logic
// to render the new RoomScene in isolation.

import RoomScene from './RoomScene'; // Make sure the path is correct

export default function Layout() {
  // All the previous hooks (useStation, useEphemeralUser, etc.) are removed for now.
  // The layout now simply returns the new, self-contained scene.
  return <RoomScene />;
}