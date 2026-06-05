# -----------------------------------------------
#     All code relevant to parallel processing
# -----------------------------------------------
def decode_parallel(input_video):
    print(f"Calculating frame bytes..")

    check_if_path_exists(input_video)

    cmd = [
        "ffmpeg", "-y",
        "-i", str(input_video),
        "-pix_fmt", "rgb24",
        "-vf", "scale=48:27",
        "-f", "rawvideo",
        "pipe:1"
    ]

    quarter_frames = spawn_parallel_processes(input_video)

    first_quarter_frames = quarter_frames[0]
    second_quarter_frames = quarter_frames[1]
    third_quarter_frames = quarter_frames[2]
    fourth_quarter_frames = quarter_frames[3]
    
    # print(f"first_quarter_frames = {first_quarter_frames}")
    # print(f"----------------------------------------------")
    # print(f"second_quarter_frames = {second_quarter_frames}")
    # print(f"----------------------------------------------")
    # print(f"third_quarter_frames = {third_quarter_frames}")
    # print(f"----------------------------------------------") 
    # print(f"fourth_quarter_frames = {fourth_quarter_frames}")
    # process = subprocess.


    def probe_video_duration(input_video):
    cmd = [
        "ffprobe",
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        input_video
    ]

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True
    )

    duration = float(result.stdout.strip())

    print(duration)
    return duration

def get_video_ranges(input_video):
    duration = probe_video_duration(input_video)

    first_quarter = (0, duration * 0.25)
    second_quarter = (duration * 0.25, duration * 0.50)
    third_quarter = (duration * 0.50, duration * 0.75)
    last_quarter = (duration * 0.75, duration)

    return (first_quarter, second_quarter, third_quarter, last_quarter)

def build_ffmpeg_cmd(input_video, start, end):
    return [
        "ffmpeg", "-y",
        "-ss", str(start),
        "-to", str(end),
        "-i", str(input_video),
        "-pix_fmt", "rgb24",
        "-vf", "scale=48:27",
        "-f", "rawvideo",
        "pipe:1",
    ]

def read_process_frames(process_index, process):
    print(f"[Process {process_index}] Started reading")

    start_time = time.perf_counter()

    frames = []

    while True:
        raw_frame = process.stdout.read(FRAME_BYTES)

        if not raw_frame:
            break

        if len(raw_frame) != FRAME_BYTES:
            print(
                f"[Process {process_index}] Incomplete frame "
                f"({len(raw_frame)} bytes)"
            )
            break

        frames.append(raw_frame)

    process.wait()

    elapsed = time.perf_counter() - start_time

    print(
        f"[Process {process_index}] Finished "
        f"({len(frames)} frames, {elapsed:.2f}s)"
    )

    return frames


def spawn_parallel_processes(input_video):
    ranges = get_video_ranges(input_video)

    processes = []

    for i, (start, end) in enumerate(ranges):
        print(
            f"[Process {i}] Launching "
            f"({start:.2f}s -> {end:.2f}s)"
        )

        cmd = build_ffmpeg_cmd(input_video, start, end)

        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )

        processes.append((i, process))

    overall_start = time.perf_counter()

    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(
            executor.map(
                lambda p: read_process_frames(*p),
                processes,
            )
        )

    overall_elapsed = time.perf_counter() - overall_start

    print(
        f"\nAll processes finished in "
        f"{overall_elapsed:.2f}s"
    )

    return results

#--------------------------------------------------
#   Processes video -> runs inference in sequence
#--------------------------------------------------
def decode_video_one_pass(input_video):
    print(f"Calculating frame bytes..")
    frame_bytes = calculate_frame_bytes(FRAME_WIDTH, FRAME_HEIGHT, FRAME_CHANNELS)

    check_if_path_exists(input_video)

    cmd = [
        "ffmpeg", "-y",
        "-i", str(input_video),
        "-pix_fmt", "rgb24",
        "-vf", "scale=48:27",
        "-f", "rawvideo",
        "pipe:1"
    ]

    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL, 
    )

    if process.stdout is None:
        raise RuntimeError("Failed to open FFmpeg stdout pipe")

    pbar = tqdm(
        desc = "Decoding video..",
        unit="frames",
        file=sys.stdout
    )

    frames: list[np.ndarray] = []

    while True:
        raw_frame = process.stdout.read(frame_bytes)

        if len(raw_frame) == 0:
            break
        
        if len(raw_frame) != frame_bytes:
            print(f"[ATTENTION] raw frame is not equal to frame bytes")

        frame = np.frombuffer(raw_frame, dtype=np.uint8).reshape(
            FRAME_HEIGHT, FRAME_WIDTH, FRAME_CHANNELS
        )
        
        frames.append(frame)

        pbar.update(1)
    pbar.close()
    return np.stack(frames)

def run_model_one_pass(frames, input_file, batch_size=100, overlap=50):
    num_frames = len(frames)

    scores = np.zeros(len(frames))
    counts = np.zeros(len(frames))

    stride = batch_size - overlap

    device = "cuda" if torch.cuda.is_available() else "cpu"
    
    model = TransNetV2(device=device)
    model.eval()

    progress = tqdm(
        total = len(frames),
        desc="Scene Detection",
        unit="frames"
    )

    for start in range(0, len(frames), stride):
        end = min(start + batch_size, num_frames)
        frames_batch = frames[start : end].copy()

        tensor = torch.from_numpy(frames_batch).unsqueeze(dim=0).to(device)

        single_frame_pred, _ = model(tensor)
        preds = single_frame_pred.detach().cpu().numpy().squeeze()

        scores[start : end] += preds
        counts[start : end] += 1
        progress.update(stride)

    final_scores = scores / counts
    scenes = model.predictions_to_scenes(final_scores)
    
    second_timestamps, frame_timestamps = convert_scenes_to_timestamps(
        input_file, 
        scenes
    )
    progress.close()
    return second_timestamps, frame_timestamps


# deprecated method of splitting scenes to webp compressed
# Good for app performance but slow and a hassle.
def create_scene_previews_deprecated(
    input_video,
    scenes_secs,
    output_folder,
    frame_step=3,
    preview_fps=7,
    preview_width=320,
    preview_crf=36,
    preview_preset="veryfast",
    thumbnail_width=640,
    thumbnail_webp_quality=78,
    thumbnail_time_ratio=0.30,
    max_workers=None,
    skip_existing=True,
):
    print("Hitting scene previews func")

    input_video = Path(input_video)
    output_root = resolve_paths(output_folder)
    os.makedirs(output_root, exist_ok=True)

    print(f"name of video: {input_video.name}")

    if max_workers is None:
        cpu_count = os.cpu_count() or 1
        max_workers = max(1, min(4, cpu_count))

    def _scene_paths(scene_index):
        scene_dir_name = f"{input_video.stem}_SCENE_{scene_index:04d}"
        output_dir = output_root / scene_dir_name
        os.makedirs(output_dir, exist_ok=True)
        preview_video_path = output_dir / "preview.mp4"
        poster_path = output_dir / "poster.webp"
        return output_dir, preview_video_path, poster_path

    def _scene_info(scene_index, scene):
        start_sec = float(scene[0])
        end_sec = float(scene[1])
        duration = end_sec - start_sec

        return start_sec, end_sec, duration

    def _generate_thumbnail_for_scene(scene_index, scene):
        print(f"Generating thumbnail for scene {scene_index}")
        start_sec, _end_sec, duration = _scene_info(scene_index, scene)

        output_dir, _preview_video_path, poster_path = _scene_paths(scene_index)

        if duration <= 0:
            return {
                "scene_id": scene_index,
                "preview_dir": str(output_dir),
                "poster_path": None,
                "thumbnail_status": "skipped_invalid_duration",
            }

        thumb_time = start_sec + (duration * float(thumbnail_time_ratio))
        if thumb_time >= (start_sec + duration):
            thumb_time = start_sec

        if skip_existing and poster_path.exists():
            return {
                "scene_id": scene_index,
                "preview_dir": str(output_dir),
                "poster_path": str(poster_path),
                "thumbnail_status": "cached",
            }

        thumbnail_cmd = [
            "ffmpeg",
            "-y",
            "-ss",
            str(thumb_time),
            "-i",
            str(input_video),
            "-frames:v",
            "1",
            "-vf",
            f"scale={thumbnail_width}:-2:flags=bicubic",
            "-c:v",
            "libwebp",
            "-compression_level",
            "5",
            "-quality",
            str(thumbnail_webp_quality),
            str(poster_path),
        ]

        thumb_process = subprocess.run(thumbnail_cmd, capture_output=True, text=True)
        if thumb_process.returncode != 0:
            print(thumb_process.stderr)
            raise RuntimeError(f"Failed to create thumbnail for scene {scene_index}")

        return {
            "scene_id": scene_index,
            "preview_dir": str(output_dir),
            "poster_path": str(poster_path),
            "thumbnail_status": "ok",
        }

    def _generate_preview_video_for_scene(scene_index, scene):
        print(f"Generating preview video for scene {scene_index}")
        start_sec, _end_sec, duration = _scene_info(scene_index, scene)

        output_dir, preview_video_path, _poster_path = _scene_paths(scene_index)

        if duration <= 0:
            return {
                "scene_id": scene_index,
                "preview_dir": str(output_dir),
                "preview_video": None,
                "video_status": "skipped_invalid_duration",
            }

        if skip_existing and preview_video_path.exists():
            return {
                "scene_id": scene_index,
                "preview_dir": str(output_dir),
                "preview_video": str(preview_video_path),
                "video_status": "cached",
            }

        cmd = [
            "ffmpeg",
            "-y",
            "-ss",
            str(start_sec),
            "-i",
            str(input_video),
            "-t",
            str(duration),
            "-vf",
            f"fps={preview_fps},scale={preview_width}:-2:flags=fast_bilinear",
            "-c:v",
            "libx264",
            "-preset",
            str(preview_preset),
            "-crf",
            str(preview_crf),
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            "-an",
            str(preview_video_path),
        ]

        process = subprocess.run(cmd, capture_output=True, text=True)

        if process.returncode != 0:
            print(process.stderr)
            raise RuntimeError(f"Failed to create preview video for scene {scene_index}")

        return {
            "scene_id": scene_index,
            "preview_dir": str(output_dir),
            "preview_video": str(preview_video_path),
            "video_status": "ok",
        }

    # Stage 1: generate thumbnails first so the UI can paint all static cards early.
    thumb_results_by_scene = {}
    with ThreadPoolExecutor(max_workers=max_workers) as thumbnail_executor:
        thumbnail_futures = [
            thumbnail_executor.submit(_generate_thumbnail_for_scene, i, scene)
            for i, scene in enumerate(scenes_secs)
        ]
        for future in as_completed(thumbnail_futures):
            result = future.result()
            thumb_results_by_scene[result["scene_id"]] = result

    # Stage 2: generate lower-quality hover preview videos in parallel.
    preview_results_by_scene = {}
    with ThreadPoolExecutor(max_workers=max_workers) as video_executor:
        video_futures = [
            video_executor.submit(_generate_preview_video_for_scene, i, scene)
            for i, scene in enumerate(scenes_secs)
        ]
        for future in as_completed(video_futures):
            result = future.result()
            preview_results_by_scene[result["scene_id"]] = result

    preview_metadata = []
    for i in range(len(scenes_secs)):
        thumb_result = thumb_results_by_scene.get(i, {})
        video_result = preview_results_by_scene.get(i, {})

        preview_metadata.append(
            {
                "scene_id": i,
                "preview_dir": thumb_result.get("preview_dir") or video_result.get("preview_dir"),
                "poster_path": thumb_result.get("poster_path"),
                "preview_video": video_result.get("preview_video"),
                "thumbnail_status": thumb_result.get("thumbnail_status", "unknown"),
                "video_status": video_result.get("video_status", "unknown"),
                "frame_step": frame_step,
                "status": "ok"
                if thumb_result.get("thumbnail_status") in ("ok", "cached")
                and video_result.get("video_status") in ("ok", "cached")
                else "partial",
            }
        )

    return preview_metadata

# compresses entire video so react frontend could pull from it. This also takes too long so deprecated
def compress_video_for_proxy_deprecated(input_video, output_video):
    cmd = [
        "ffmpeg",
        "-y",
        "-i", str(input_video),
        "-vf", "fps=10,scale=-2:360",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "30",
        "-an",
        str(output_video),
    ]

    start = time.time()
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        print(result.stderr)
        raise RuntimeError("Failed to create proxy video")

    end = time.time()

    print(f"TOTAL TIME TAKEN FOR PROXY: {end - start}")

    return output_video

def insert_table():
    pass
