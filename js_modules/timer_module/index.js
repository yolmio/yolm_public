const __v2 = 1;
const activeTimers = new Map();

function startTimer(args) {
  const handle = args.handle;
  const intervalId = setInterval(() => {
    emit("tick", { handle, json: { timestamp: Date.now() } });
  }, 1000);
  activeTimers.set(handle, intervalId);
  return { handle };
}

function stopTimer(args) {
  const handle = args?.handle;
  if (!handle) {
    return;
  }
  const intervalId = activeTimers.get(handle);
  if (intervalId) {
    clearInterval(intervalId);
    activeTimers.delete(handle);
  }
}

registerModule({
  startTimer,
  stopTimer,
});
