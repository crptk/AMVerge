import sys
import json
import time
from discord_rpc import DiscordRPC

def main():
    from discord_rpc import RPC_AVAILABLE
    if not RPC_AVAILABLE:
        return

    rpc = DiscordRPC()
    if not rpc.connect():
        pass
    
    last_update_time = 0
    last_details = ""
    last_state = ""
    
    while True:
        line = sys.stdin.readline()
        if not line:
            break
        
        print(f"[RPC Server] Received: {line.strip()}")
        try:
            data = json.loads(line)
            if data.get("type") == "update":
                current_time = time.time()
                details = data.get("details")
                state = data.get("state")
                
                time_passed = current_time - last_update_time
                activity_changed = details != last_details
                
                if time_passed >= 15 or activity_changed:
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
                    last_state = state
            elif data.get("type") == "clear":
                rpc.clear_presence()

            elif data.get("type") in ("exit", "shutdown"):
                rpc.clear_presence()
                time.sleep(0.2)
                break
        except Exception:
            pass

    rpc.disconnect()

if __name__ == "__main__":
    main()