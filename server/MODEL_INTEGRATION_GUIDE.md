# Model integration

RAPID ships with `server/model.py`, which loads the checkpoint in `pinn/` and exposes `predict_benzene(payload)`. The HTTP server discovers that interface at startup and routes `/api/simulate` through it.

## Prediction contract

An alternative Python model may expose `predict_benzene`, `predict_concentration`, `predict`, or `run_dispersion`. The function receives a dictionary containing:

- facility and receptor identifiers and coordinates
- emission-reduction percentage
- baseline receptor concentration
- wind speed and direction
- boundary-layer inputs (`ustar`, `inv_L`, `h_bl`, `z0`, and `zi`)

It must return either a concentration number or a dictionary containing `baseline_concentration` and `simulated_concentration`. Returning a dictionary is recommended so the model can also report its name, deltas, and diagnostics.

## Browser model hook

For a WebAssembly or ONNX experiment, define `window.RAPID_CUSTOM_MODEL.predict(params)`. The browser bridge tries that hook first, then the Python API, then the built-in analytical approximation. The hook must return `baselineConcentration` and `simulatedConcentration`.

## Gemini

Gemini credentials belong on the server:

```bash
export GEMINI_API_KEY="your-key"
export GEMINI_MODEL="gemini-3.5-flash"  # optional
python3 server/model_server.py
```

The browser calls `/api/ai`; it never receives or stores the credential. Without a key, Ask RAPID uses the local scenario synthesizer.
