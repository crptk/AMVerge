FRAME_WIDTH = 48
FRAME_HEIGHT = 27
FRAME_CHANNELS = 3
FRAME_BYTES = FRAME_WIDTH * FRAME_HEIGHT * FRAME_CHANNELS
WINDOW_SIZE = 100               # how many frames the AI should process at once (batch size)
OVERLAP = 50                    # The overlap that the AI should have for context for each batch
STRIDE = WINDOW_SIZE - OVERLAP  # how much 