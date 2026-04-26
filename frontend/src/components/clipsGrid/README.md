# clipsGrid

Welcome to the clipsGrid module! This is the heart of the video grid in the AMVerge frontend. If you're reading this, you're probably about to work on the grid, add features, or debug something. Here's what you need to know to get oriented and productive.

## What This Grid Does

The grid is built to handle lots of video clips efficiently, even on lower-end machines. It keeps the UI smooth and responsive by only loading and playing videos when they're actually needed. This means:

- Videos only start loading when they're visible in the viewport or when you hover over a tile.
- If the browser can't play a video format (like HEVC/H.265), the grid will request a proxy (H.264) version and swap it in automatically.
- When previewing all clips at once, videos are mounted one at a time (not all at once), so the browser and GPU don't get overwhelmed.

## Why Lazy Loading and Proxying?

Browsers and hardware have limits. If you try to mount and play dozens of videos at once, you'll quickly run into performance issues—lag, dropped frames, or even browser crashes. Lazy loading means we only use resources for what's actually on screen. Proxying is essential for compatibility: not all users have HEVC support, so we generate and use H.264 proxies on demand.

## How It Works (Under the Hood)

- **Intersection Observer**: Each tile uses this to know when it's near the viewport. If it's not visible, we don't load the video at all.
- **Proxy Queue**: If a video can't be played natively, we request a proxy. The queue prioritizes which proxies to generate based on user interaction (hovered tiles get priority).
- **Staggered Mounting**: When grid preview is enabled, we mount one video at a time with a short delay. This keeps the UI responsive and avoids GPU stalls.
- **Selection Logic**: You can select clips with Ctrl/Cmd (multi-select) or Shift (range select), just like in a file manager.

## React Patterns Used

- **Callback Functions**: We use `useCallback` to memoize event handlers and functions passed to child components. This prevents unnecessary re-renders and keeps the grid snappy.
- **React.memo**: Components like `LazyClip` are wrapped in `React.memo` so they only re-render when their props actually change. This is crucial for performance when you have lots of tiles.
- **Refs**: We use refs to keep track of video elements and state that doesn't need to trigger a re-render (like the proxy cache or in-flight requests).

## Folder Structure

- `ClipsContainer.tsx`: The main grid container. Handles layout, selection, and passing props to tiles.
- `types.ts`: Shared TypeScript types for props and internal data.
- `gridComponents/`
  - `LazyClip.tsx`: The video tile. Handles lazy loading, hover preview, and proxy logic.
  - `proxyQueue.ts`: The hook that manages proxy generation and prioritization.
  - `staggeredMountQueue.ts`: The hook that staggers video mounting for grid preview.

## Tips for Working Here

- If you add new features, keep them modular, prefer hooks or small components.
- When in doubt, check if a function or component can be memoized.
- If you see performance issues, profile with React DevTools and look for unnecessary renders.
- Always check for browser compatibility when dealing with video formats.