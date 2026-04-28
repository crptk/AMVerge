import sys
import json
import time
import os
import threading
from discord_rpc import DiscordRPC

def monitor_stdin(rpc, shutdown_event):
    """Monitor stdin for commands from the parent process."""
    last_update_time = 0
    last_details = ""
    
    while not shutdown_event.is_set():
        line = sys.stdin.readline()
        if not line:
            print("[RPC Server] Stdin closed, shutting down...")
            shutdown_event.set()
            break
            
        try:
            data = json.loads(line)
            if data.get("type") == "update":
                current_time = time.time()
                details = data.get("details")
                state = data.get("state")
                
                # Simple throttling
                time_passed = current_time - last_update_time
                if time_passed >= 15 or details != last_details:
                    rpc._update(
                        details=details,
                        state=state,
                        large_image=data.get("large_image", "amverge_logo"),
                        large_text=data.get("large_text", "AMVerge"),
                        small_image=data.get("small_image"),
                        small_text=data.get("small_text"),
                        buttons=data.get("buttons", True)
                    )
                    last_update_time = current_time
                    last_details = details
            elif data.get("type") == "clear":
                rpc.clear_presence()
            elif data.get("type") in ("exit", "shutdown"):
                print("[RPC Server] Received shutdown command...")
                shutdown_event.set()
                break
        except Exception as e:
            print(f"[RPC Server] Error processing command: {e}")

def main():
    from discord_rpc import RPC_AVAILABLE
    if not RPC_AVAILABLE:
        return

    rpc = DiscordRPC()
    if not rpc.connect():
        print("[RPC Server] Could not connect to Discord")
    
    shutdown_event = threading.Event()
    
    # Start stdin monitor in a background thread
    thread = threading.Thread(target=monitor_stdin, args=(rpc, shutdown_event), daemon=True)
    thread.start()
    
    # Record parent PID to detect if it dies
    parent_pid = os.getppid()
    
    print(f"[RPC Server] Started. Monitoring Parent PID: {parent_pid}")
    
    try:
        while not shutdown_event.is_set():
            # Check if parent is still alive
            if os.name == 'nt':
                # On Windows, we can check if the process still exists
                # A simple way without psutil:
                import subprocess
                # tasklist is slow, but we only check every second
                try:
                    # If this returns non-zero, the process is likely gone
                    if parent_pid > 0:
                        # Find if parent_pid is in the tasklist
                        res = subprocess.call(['tasklist', '/FI', f'PID eq {parent_pid}'], 
                                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                        # Note: tasklist returns 0 even if not found, we check the output usually
                        # Instead, we rely on the fact that stdin will close.
                        pass
                except:
                    pass
            else:
                # Unix is easy
                if os.getppid() != parent_pid:
                    print("[RPC Server] Parent process changed or died. Exiting...")
                    shutdown_event.set()
            
            time.sleep(1.0)
    except KeyboardInterrupt:
        pass
    
    print("[RPC Server] Cleaning up...")
    rpc.clear_presence()
    rpc.disconnect()
    print("[RPC Server] Shutdown complete.")

if __name__ == "__main__":
    main()