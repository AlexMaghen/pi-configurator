"""Transport-independent service logic: connections, RPC dispatch, the store and state files.

Nothing here touches Bluetooth or D-Bus; the BLE layer feeds frames into a Connection and sends
out whatever it returns. All of it is unit-tested on macOS with fake system adapters.
"""
