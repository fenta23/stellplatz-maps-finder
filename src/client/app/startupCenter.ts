/** Whether the startup location fix may recentre the map on the user. */
export function shouldCenterOnUser(state: { readonly userMovedMap: boolean; readonly routeActive: boolean }): boolean {
  // A route that is active at startup is fitted instead; the user's own panning wins as well.
  return !state.userMovedMap && !state.routeActive
}
