## v1.2.6 
- Fixed AMVerge updater failing

## v1.2.5
- Fixed videos not playing in windows media player

## v1.2.4
- Fixed issues with certain files not importing (files that had a '%' sign or certain special characters in the name weren't filtered properly)
- Made it so if you export clips, it'll export with the selected audio stream as the default audio. This should help for editors like After Effects that only using one track, it'll use the one the user exported as (note that it still exports all tracks in the episode, just reordering so the selected track is the default one)

## v1.2.3
- Added safeguards for clearing episode patch so it doesn't wipe everything in there

## v1.2.2
- Fixed episodes disappearing on startup (let me know if this is still an issue)
- Fixed some windows users experiencing python build errors

## v1.2.1
- Fixed hovered videos sometimes not displaying full clip content

## v1.2.0
- Added audio stream change for previewing
- Added an "Update Available!" notification in case the download button doesn't work on update notification
- Potentially fixed major issue with the app having a soft limit on its storage (if this is still an issue, please let me know)
- Fixed timeline click not working
- Fixed audio toggle resetting video
- Fixed intel macs not importing episodes properly

## v1.0.0
- Now supports mac

- Backend now merges clips that have similar thumbnails together. This should help with videos that cut weirdly

- Added export settings
  - You can now select profiles to adjust various export settings
  - Profiles have customizable icons (more customizability!)

- Added quick download buttons to clips
  - Download individual clips directly from the grid
  - Useful when you only need a few clips instead of exporting everything
  - This can be toggled in Appearance settings

- Added audio hover
  - Hovering over clips now plays audio
  - Makes it easier to find specific voice lines or sound effects

- Added Discord Rich Presence support
  - AMVerge now shows on your Discord status while you’re using it

- General settings improvements
  - Added a new "General" section in Settings
  - You can now change where episodes are stored
  - Added option to reset all settings back to default

- Appearance settings updates
  - Background image improvements:
    - Now supports GIFs and more file formats
    - Includes a built-in cropper/editor for better control
    - Adjustable opacity and blur
  - Color system updates:
    - Accent color slider now automatically adjusts background color
    - Updated color slider UI to match the rest of the app
  - Can now toggle "Widescreen clip tiles" to have clips grid in 1920x1080 aspect ratio
  - Can now toggle "Show clip timestamps" to have the clip timestamps on the grid

- UI updates
  - Redesigned export interface
  - Sidebar buttons are now icon-based instead of text

- QOL
  - Added video length the video in the preview panel (next to the time bar)
  - Automatically opens location where video was exported after export (toggleable in export settings)
  - Export Now button is now disabled/faded when no clips are selected.
  - Now loads the last selected episode on startup
- Patches
  - Fixed issue where large video files wouldn't import
  - Fixed issue where 4K+ images could turn white on import