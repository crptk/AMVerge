import time
import threading
from typing import Optional, Any

try:
    from pypresence.presence import Presence
    from pypresence import exceptions as rpc_exceptions
    RPC_AVAILABLE = True
except ImportError:
    Presence = None
    RPC_AVAILABLE = False
    rpc_exceptions = None

# Discord Application ID
CLIENT_ID = "1497922104065134823" 

class DiscordRPC:
    """Discord Rich Presence handler for AMVerge."""
    
    def __init__(self, client_id: str = CLIENT_ID):
        self.client_id = client_id
        self.rpc: Optional[Any] = None
        self.connected = False
        self._lock = threading.Lock()
        
    def connect(self) -> bool:
        """Connect to Discord RPC."""
        if not RPC_AVAILABLE or Presence is None:
            print("[Discord RPC] pypresence not installed. Run: pip install pypresence")
            return False
            
        if self.connected:
            return True
            
        try:
            with self._lock:
                self.rpc = Presence(self.client_id)
                self.rpc.connect()
                self.connected = True
                print("[Discord RPC] Connected to Discord")
                return True
        except Exception as e:
            print(f"[Discord RPC] Failed to connect: {e}")
            self.connected = False
            return False
    
    def clear_presence(self):
        """Clear Discord presence."""
        if self.rpc and self.connected:
            try:
                with self._lock:
                    self.rpc.clear()
            except Exception:
                pass

    def disconnect(self):
        """Disconnect from Discord RPC."""
        if self.rpc and self.connected:
            try:
                with self._lock:
                    self.rpc.close()
                    self.connected = False
                    print("[Discord RPC] Disconnected from Discord")
            except Exception:
                pass
    
    def update_idle(self):
        """Set status to idle/ready."""
        self._update(
            state="Idle",
            details="Ready to process videos",
            large_image="amverge_logo",
            large_text="AMVerge",
        )
    
    def update_detecting(self, file_name: str = "", progress: float = 0):
        """Set status to detecting scenes."""
        self._update(
            state=f"Detecting Scenes ({progress:.0f}%)",
            details=f"File: {file_name}" if file_name else "Processing video",
            large_image="amverge_logo",
            large_text="AMVerge",
        )

    def update_selecting(self, count: int = 0):
        """Set status to selecting clips."""
        self._update(
            state=f"Selecting Clips ({count} selected)",
            details="Editing Episode",
            large_image="amverge_logo",
            large_text="AMVerge",
        )

    def update_exporting(self, file_name: str = "", progress: float = 0):
        """Set status to exporting."""
        self._update(
            state=f"Exporting ({progress:.0f}%)",
            details=f"Saving: {file_name}" if file_name else "Exporting clips",
            large_image="amverge_logo",
            large_text="AMVerge",
        )

    def update_navigating(self, page: str = ""):
        """Set status to navigating."""
        self._update(
            state=f"In {page.capitalize()}",
            details="Navigating menus",
            large_image="amverge_logo",
            large_text="AMVerge",
        )
    
    def update_complete(self):
        """Set status to complete."""
        self._update(
            state="Done",
            details="Process complete!",
            large_image="amverge_logo",
            large_text="AMVerge",
        )
    
    def update_error(self, error_msg: str = ""):
        """Set status to error."""
        self._update(
            state="Error",
            details=error_msg[:128] if error_msg else "An error occurred",
            large_image="amverge_logo",
            large_text="AMVerge",
        )
    
    def _update(
        self,
        state: Optional[str] = None,
        details: Optional[str] = None,
        large_image: Optional[str] = None,
        large_text: Optional[str] = None,
        small_image: Optional[str] = None,
        small_text: Optional[str] = None,
        buttons: bool = True,
    ):
        """Internal method to update Discord presence."""
        if not self.connected or not self.rpc:
            print("[Discord RPC] Not connected, skipping update")
            return
            
        try:
            with self._lock:
                # Hardcoded buttons
                buttons_list = []
                if buttons: # This 'buttons' argument will now be used as a toggle
                    buttons_list = [
                        {"label": "Discord Server", "url": "https://discord.gg/asJkqwqb"},
                        {"label": "Website", "url": "https://amverge.app/"}
                    ]
                
                print(f"[Discord RPC] Updating: {details} | {state}")
                self.rpc.update(
                    state=state,
                    details=details,
                    large_image=large_image,
                    large_text=large_text,
                    small_image=small_image,
                    small_text=small_text,
                    buttons=buttons_list if buttons_list else None,
                )
        except Exception as e:
            print(f"[Discord RPC] Update failed: {e}")
            # Try to reconnect on next update
            self.connected = False


# Global instance
_rpc_instance: Optional[DiscordRPC] = None


def get_rpc() -> DiscordRPC:
    """Get or create the global Discord RPC instance."""
    global _rpc_instance
    if _rpc_instance is None:
        _rpc_instance = DiscordRPC()
    return _rpc_instance


def init_rpc() -> bool:
    """Initialize and connect Discord RPC."""
    rpc = get_rpc()
    return rpc.connect()


def close_rpc():
    """Close Discord RPC connection."""
    global _rpc_instance
    if _rpc_instance:
        _rpc_instance.disconnect()
        _rpc_instance = None


# Convenience functions
def rpc_idle():
    """Set Discord status to idle."""
    rpc = get_rpc()
    if rpc.connected:
        rpc.update_idle()

def rpc_detecting(file_name: str = "", progress: float = 0):
    """Set Discord status to detecting."""
    rpc = get_rpc()
    if rpc.connected:
        rpc.update_detecting(file_name, progress)

def rpc_selecting(count: int = 0):
    """Set Discord status to selecting."""
    rpc = get_rpc()
    if rpc.connected:
        rpc.update_selecting(count)

def rpc_exporting(file_name: str = "", progress: float = 0):
    """Set Discord status to exporting."""
    rpc = get_rpc()
    if rpc.connected:
        rpc.update_exporting(file_name, progress)

def rpc_navigating(page: str = ""):
    """Set Discord status to navigating."""
    rpc = get_rpc()
    if rpc.connected:
        rpc.update_navigating(page)

def rpc_complete():
    """Set Discord status to complete."""
    rpc = get_rpc()
    if rpc.connected:
        rpc.update_complete()

def rpc_error(error_msg: str = ""):
    """Set Discord status to error."""
    rpc = get_rpc()
    if rpc.connected:
        rpc.update_error(error_msg)