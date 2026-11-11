// Omitting the scale keeps the existing 720p-bounded review profile.
export function validPlaybackScale(scale) {
  return scale === undefined || [1, 0.75, 0.5, 0.25].includes(scale);
}
