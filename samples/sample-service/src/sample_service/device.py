"""A stand-in for real hardware: a light, a speaker and a small display.

It only logs what it would do and remembers its state (the tests read it). In your own service,
this is where the GPIO, audio or display code goes; nothing in it knows about pi-configurator.
"""

import logging

log = logging.getLogger(__name__)


class Device:
    def __init__(self) -> None:
        self.color = ""
        self.volume = 0
        self.artist_name = ""
        self.playing = False

    def set_color(self, color: str) -> None:
        self.color = color
        log.info("light: %s", color)

    def set_volume(self, volume: int) -> None:
        self.volume = volume
        log.info("speaker: %s", "muted" if volume == 0 else f"volume {volume}%")

    def show_artist(self, name: str) -> None:
        self.artist_name = name
        log.info("display: %s", f"now playing {name}" if name else "(blank)")

    def play(self) -> None:
        self.playing = True
        log.info("playing")

    def stop(self) -> None:
        if self.playing:
            self.playing = False
            log.info("stopped")
