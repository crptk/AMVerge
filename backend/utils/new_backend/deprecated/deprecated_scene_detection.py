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