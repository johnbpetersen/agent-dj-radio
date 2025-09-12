# Station Track Repeat Behavior Plan

## Current Behavior
- Track replay via admin panel calls `/api/admin/advance` with `replay: true`
- Stage.tsx handles track restart by forcing reload: `a.src = url; a.load(); a.currentTime = 0`
- Same track ID with same audio URL triggers proper restart logic
- WebAudio chain recreated on track change (when enabled)

## Key Implementation Points
✅ **Already Working**: Track restart logic in Stage.tsx (lines 264-279)
✅ **Already Working**: Unlock state preserved across replays (`wasUnlocked` check)  
✅ **Already Working**: Admin replay functionality in `/api/admin/advance`

## Potential Edge Cases to Monitor
1. **Multiple rapid replays** - Current logic should handle but monitor for race conditions
2. **WebAudio state persistence** - MediaElementSource recreated on each replay (correct behavior)
3. **Progress sync** - Drift detection resync logic handles progress jumps (lines 297-305)

## Recommendations
- **No changes needed** - Current implementation handles replays correctly
- **Monitor**: Add metrics to track replay success rate if needed
- **Future**: Consider replay history/analytics if user engagement requires it

## Debug Helpers
- Use `__audioState()` in dev console to inspect audio element state
- Enable `VITE_DEBUG_AUDIO=true` for detailed replay logs
- Check `wasUnlocked` state preservation across replays

## Testing Checklist
- [x] Replay starts from beginning (currentTime = 0)
- [x] Audio unlocked state preserved 
- [x] Progress tracking resyncs properly
- [x] WebAudio chain recreated when enabled
- [x] Multiple sequential replays work