import { open } from '@tauri-apps/plugin-shell';

export default function About() {
  return (
    <section className="settings-section about-section">
      <h3>About AMVerge</h3>
      <div className="about-content" style={{ fontFamily: "Arial, sans-serif" }}>
        <p>
          I hate scene selection. Do you hate scene selection? I’m guessing since you downloaded this app, the answer is yes. AMVerge gives you a faster way to skim through episodes and find the parts you actually want to edit.
        </p>

        <p>
          There have been way too many times where I personally banged my head against the wall trying to find one specific moment in a sea of episodes. Now I don’t have to deal with that nearly as much. Here are some benefits I’ve gathered from my lovely testers and from using it myself:
        </p>

        <h4>Benefits</h4>
        <ul>
          <li>
            <strong>Quick Skimming Through Episodes:</strong> Having all the clips displayed in a grid lets you quickly see which scenes look good and which ones don’t.
          </li>
          <li>
            <strong>Finding Specific Scenes:</strong> Had a scene in mind but no clue what episode it was from? This is one of the biggest reasons I made the app.
          </li>
          <li>
            <strong>Zero Quality Loss:</strong> Clips are exported as a 1:1 copy, so there should be little to no quality loss.
          </li>
          <li>
            <strong>MP4 Conversion:</strong> One of my friends uses this just to convert clips into mp4. I didn’t even know that would be a use case, but yes, every exported clip is mp4. No more annoying After Effects mkv issues.
          </li>
        </ul>

        <h4>UI</h4>
        <ul>
          <li>
            <strong>Episode Panel:</strong> On the left side, you can organize episodes, create folders, and manage imported content. The <b>Clear</b> button removes cached files to free space. It does <u>not</u> delete your original videos.
          </li>
          <li>
            <strong>Home:</strong> Your main workspace for browsing clips and making selections.
          </li>
          <li>
            <strong>Menu:</strong> Contains this page, console (for bugs or errors), update logs, and credits to everyone who helped with the project.
          </li>
          <li>
            <strong>Settings:</strong> Manage your application settings and customize the look of AMVerge.
          </li>
        </ul>

        <h4>Recommended Workflow</h4>
        <ol>
          <li>
            <strong>Import:</strong> Add your episode(s) or movie(s). Formats like mp4, mkv, webm, and more are supported.
          </li>
          <li>
            <strong>Browse:</strong> Skim through clips and grab anything that looks useful. Don’t overthink it early on. If a fight scene gets split into multiple clips, select them together and use merge.
          </li>
          <li>
            <strong>Enable Merge & Export:</strong> Merge selected clips into full scenes or compilations of your favorite moments. This also helps fix clips that were cut awkwardly.
          </li>
        </ol>

        <p>
          <em>
            This is the workflow I personally use, but AMVerge is flexible enough to fit however you like to edit.
          </em>
        </p>

        <h4>Selecting Clips</h4>
        <ul>
          <li>
            <b>Single Click:</b> Focus a clip and load it into the preview screen.
          </li>
          <li>
            <b>Ctrl + Click or Double Click:</b> Select multiple clips one by one.
          </li>
          <li>
            <b>Shift + Click:</b> Select everything between your focused clip and the clip you clicked.
          </li>
        </ul>

        <p>
          Only selected clips will export, and they’ll be saved to the export folder set below the preview player.
        </p>

        <h4>Grid Preview</h4>
        <p>
          Turn on <b>Grid Preview</b> to preview clips across the grid while you scroll. It’s great for quickly skimming large episodes and spotting scenes fast.
        </p>

        <p>
          <b>Important:</b> If too many clips are visible at once, Grid Preview can be heavy and slow things down. If that happens, increase the grid size until it feels comfortable.
        </p>

        <h4>Episode Panel Cache</h4>
        <p>
          AMVerge stores imported episode data so you can quickly revisit past imports. If you need space, use the "Clear" button. This removes clips from the episode panel only and does not touch your original episode or movie files.
        </p>

        <h4>HEVC (H.265) Support</h4>
        <p>
          In the top right, there’s a HEVC status indicator. If your PC supports HEVC, previews load much faster for many newer encodes.
        </p>

        <p>
          If HEVC support is missing, some videos may need conversion before previewing, which can slow things down.
        </p>

        <p>
          <b>Recommendation:</b> Installing the official Microsoft HEVC extension is worth it for the smoothest experience.
        </p>

        <h4>How AMVerge Splits Episodes</h4>
        <p>
          AMVerge splits videos using <strong>I-Frames</strong> (keyframes). It does not use traditional scene detection.
        </p>

        <ul>
          <li>
            <b>What are I-Frames?</b> Full image frames placed throughout a video, often around cuts or major visual changes.
          </li>
          <li>
            <b>Why use them?</b> It allows near-instant splitting with no full re-encode, so importing is fast.
          </li>
          <li>
            <b>Downside:</b> Some encodes place I-Frames in weird spots, creating short or duplicate clips. Those can be merged back together inside AMVerge.
          </li>
        </ul>

        <h4>Why Use AMVerge?</h4>
        <ul>
          <li>
            <b>Faster Browsing:</b> Scan clips visually instead of scrubbing frame by frame.
          </li>
          <li>
            <b>Cleaner Editing:</b> Find moments faster, export only what matters, and keep projects organized.
          </li>
          <li>
            <b>Flexible:</b> Built for different editing styles, not just one workflow.
          </li>
        </ul>

        <h4>Need Help?</h4>
        <p>
          For bug reports, updates, feature requests, or support, feel free to join the 
        {" "}
        <a
        href="#"
        onClick={e => {
            e.preventDefault();
            open("https://discord.gg/bmXjTgsAaN");
        }}
        > AMVerge discord.</a>
        </p>

        <p>
          <em>
            Thanks for using my app. I’ve worked on this for 4 months from late December to release day (April 25 2026), and I hope it helps people improve their workflow and makes editing easier for everyone.
            <br />
            Regards, Crptk
          </em>
        </p>
      </div>
    </section>
  );
}