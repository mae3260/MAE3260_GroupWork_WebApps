// GroupWork 13F: self-driving car simulation, shared by index.html (the student page)
// and leaderboard.html (which re-runs every submitted run so the times can't be faked).
// Loaded as a classic script; everything is exposed on window.GW13FSim.
(function () {
    "use strict";
    // ---------------------------------------------------------------
    // Parameters (setup_parameters in the script)
    // ---------------------------------------------------------------
    const CAR = { m: 1400, L: 4.5, J: 1, Tdist: 3, Tmax: 500 };
    const ROAD = { L1: 50, R: 10, L2: 60, LaneW: 3.7 };
    const SIM = { dt: 0.005, H: 0.1, sig: 0.001 };
    const BDRAG = 100, SEED = 101;
    const GOAL_Y = 60;      // the course counts as finished at North = 60 m
    const MAX_STRETCH = 2;  // a run may last up to 2x the script's run time before giving up

    function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
    function makeRandn(seed) { const u = mulberry32(seed); let spare = null; return function () { if (spare !== null) { const s = spare; spare = null; return s; } let a = 0; while (a === 0) a = u(); const b = u(), r = Math.sqrt(-2 * Math.log(a)); spare = r * Math.sin(2 * Math.PI * b); return r * Math.cos(2 * Math.PI * b); }; }

    // number of elements of MATLAB's a:dt:b
    function colonLen(a, dt, b) { const q = (b - a) / dt; return Math.floor(q + 1e-10 * Math.max(1, Math.abs(q))) + 1; }

    // ---------------------------------------------------------------
    // setuproad
    // ---------------------------------------------------------------
    // stretch > 1 extends the final straight (and the time vector) so the run can last stretch x as long;
    // ntNom is the length the script itself would use
    function setupRoad(V, stretch) {
      const dt = SIM.dt, L1 = ROAD.L1, L2 = ROAD.L2, R = ROAD.R, LW = ROAD.LaneW;
      const Lt1 = L1 / V, Lt2 = (L1 + Math.PI * R / 2) / V, Lend = (L1 + Math.PI * R / 2 + L2) / V;
      const nt1 = colonLen(0, dt, Lt1), s1end = (nt1 - 1) * dt;
      const nt2 = colonLen(s1end, dt, Lt2) - 1, s2end = s1end + nt2 * dt;
      const ntNom = nt1 + nt2 + colonLen(s2end, dt, Lend) - 1;
      const nt3 = colonLen(s2end, dt, Lend * (stretch > 1 ? stretch : 1)) - 1;
      const nt = nt1 + nt2 + nt3;
      const t = new Float64Array(nt);
      for (let i = 0; i < nt1; i++) t[i] = i * dt;
      for (let i = 1; i <= nt2; i++) t[nt1 + i - 1] = s1end + i * dt;
      for (let i = 1; i <= nt3; i++) t[nt1 + nt2 + i - 1] = s2end + i * dt;
      const npts = Math.round(SIM.H / dt);
      const W = (Math.PI / 2) / (nt2 * dt), tot = nt + npts;
      const cx = new Float64Array(tot), cy = new Float64Array(tot), lx = new Float64Array(tot), ly = new Float64Array(tot), rx = new Float64Array(tot), ry = new Float64Array(tot);
      let th = 0; lx[0] = 0; ly[0] = LW / 2; rx[0] = 0; ry[0] = -LW / 2;
      const VLc = V * (R - LW / 2) / R, VRc = V * (R + LW / 2) / R;
      for (let k = 1; k < tot; k++) { // 0-based k <-> MATLAB k+1; Omega/VL/VR index k-1 (0-based) = MATLAB k
        const j = k - 1; let om = 0, vl = V, vr = V;
        if (j >= nt1 && j < nt1 + nt2) { om = W; vl = VLc; vr = VRc; }
        const c = Math.cos(th), s = Math.sin(th);
        cx[k] = cx[k - 1] + dt * V * c; cy[k] = cy[k - 1] + dt * V * s;
        lx[k] = lx[k - 1] + dt * vl * c; ly[k] = ly[k - 1] + dt * vl * s;
        rx[k] = rx[k - 1] + dt * vr * c; ry[k] = ry[k - 1] + dt * vr * s;
        th += dt * om;
      }
      return { t, nt, ntNom, nt1, nt2, nt3, npts, cx, cy, lx, ly, rx, ry };
    }

    // ---------------------------------------------------------------
    // plot_idealcase: delta_ideal
    // ---------------------------------------------------------------
    function idealDelta(rd, V) {
      const { nt, npts, cx, cy } = rd, dt = SIM.dt, L = CAR.L;
      const d = new Float64Array(nt - 1); let x = 0, y = 0, p = 0;
      for (let k = 1; k <= nt - 2; k++) {
        const nx = x + dt * V * Math.cos(p), ny = y + dt * V * Math.sin(p), np = p + dt * V / L * Math.tan(d[k - 1]);
        x = nx; y = ny; p = np;
        const th1 = Math.atan2(cy[k + npts] - y, cx[k + npts] - x);
        d[k] = Math.atan(((th1 - p) / (npts * dt)) * L / V);
      }
      return d;
    }

    // ---------------------------------------------------------------
    // The simulation loop (same order of operations as the script)
    // ---------------------------------------------------------------
    function simulate(p, opts) {
      const V = p.V, dt = SIM.dt, L = CAR.L, J = CAR.J, m = CAR.m, sig = SIM.sig;
      // the run is allowed up to MAX_STRETCH x the script's length; a car already past the goal at the
      // script's end time stops there (same result as the script), a slower car keeps going until it crosses the goal
      const rd = setupRoad(V, MAX_STRETCH), { nt, npts, cx, cy } = rd, nAlloc = nt - 1, nNom = rd.ntNom - 1, tot = cx.length, n = nAlloc;
      const dIdeal = idealDelta(rd, V);
      const randn = (opts && opts.randn) || makeRandn(SEED), noise = !(opts && opts.noNoise), fullSearch = !!(opts && opts.fullSearch);
      const X = new Float64Array(n), Y = new Float64Array(n), Psi = new Float64Array(n);
      const W1 = new Float64Array(n), W2 = new Float64Array(n), W3 = new Float64Array(n);
      const R1 = new Float64Array(n), R2 = new Float64Array(n), R3 = new Float64Array(n);
      const S1 = new Float64Array(n), S2 = new Float64Array(n), T = new Float64Array(n), Tt = new Float64Array(n), F = new Float64Array(n), errRoad = new Float64Array(n);
      S1[0] = V; const lim = 30 * Math.PI / 180, win = Math.ceil(4 / (V * dt)) + 5;
      let best = 0, nUsed = nAlloc;
      for (let k = 1; k < nAlloc; k++) {
        const km = k - 1;
        // car
        X[k] = X[km] + dt * S1[km] * Math.cos(Psi[km]); Y[k] = Y[km] + dt * S1[km] * Math.sin(Psi[km]); Psi[k] = Psi[km] + dt * S1[km] / L * Math.tan(W1[km]);
        // wheel
        const u = Tt[km]; let th = W1[km] + dt * W2[km];
        if (th * 180 / Math.PI > 30) { W1[k] = lim; W2[k] = W2[km]; W3[k] = W3[km]; }
        else if (th * 180 / Math.PI < -30) { W1[k] = -lim; W2[k] = W2[km]; W3[k] = W3[km]; }
        else { W1[k] = th; W2[k] = W2[km] + (1 / J) * dt * u; W3[k] = W3[km] + dt * W1[km]; }
        // speed
        S1[k] = S1[km] + dt * (-BDRAG / m * S1[km]) + dt / m * F[km]; S2[k] = S2[km] + dt * S1[k];
        // measurement and reference estimate
        const x1 = X[k] + (noise ? randn() * sig : 0), y1 = Y[k] + (noise ? randn() * sig : 0);
        const th1 = Math.atan2(cy[k + npts] - y1, cx[k + npts] - x1);
        const delta = Math.atan(((th1 - Psi[k]) / (npts * dt)) * L / V);
        R1[k] = delta; R2[k] = (delta - R1[km]) / dt; R3[k] = R3[km] + dt * R1[km];
        // steering control
        const e = R1[k] - W1[k], ed = R2[k] - W2[k], ei = R3[k] - W3[k], o = -W1[k], od = -W2[k];
        let Tk;
        switch (p.steer) {
          case "PID": Tk = p.Ki * ei + p.Kp * e + p.Kd * ed; break;
          case "PID (internal fdbk)": Tk = p.Ki * ei + p.Kp * o + p.Kd * od; break;
          case "PI": Tk = p.Ki * ei + p.Kp * e; break;
          case "PI (internal fdbk)": Tk = p.Ki * ei + p.Kp * o; break;
          case "PD": Tk = p.Kp * e + p.Kd * ed; break;
          default: Tk = p.Kp * e + p.Kd * od; // PD (internal fdbk)
        }
        if (Math.abs(Tk) > CAR.Tmax) Tk = Math.sign(Tk) * CAR.Tmax;
        T[k] = Tk; const thd = W2[k];
        Tt[k] = thd > 0 ? Tk - CAR.Tdist : thd < 0 ? Tk + CAR.Tdist : Tk;
        // speed control
        const eV = V - S1[k], eVi = V * dt * k - S2[k], oV = -S1[k];
        F[k] = p.speed === "P" ? p.KpV * eV : p.speed === "PI" ? p.KiV * eVi + p.KpV * eV : p.KiV * eVi + p.KpV * oV;
        // distance to the center of the road
        let md = Infinity, bi = best;
        const a = fullSearch ? 0 : Math.max(0, best - win), b = fullSearch ? tot - 1 : Math.min(tot - 1, best + win);
        for (let j = a; j <= b; j++) { const dx = X[k] - cx[j], dy = Y[k] - cy[j], d2 = dx * dx + dy * dy; if (d2 < md) { md = d2; bi = j; } }
        if (!fullSearch && !(Math.sqrt(md) <= 3)) { md = Infinity; for (let j = 0; j < tot; j++) { const dx = X[k] - cx[j], dy = Y[k] - cy[j], d2 = dx * dx + dy * dy; if (d2 < md) { md = d2; bi = j; } } }
        best = bi; errRoad[k] = Math.sqrt(md);
        if (k >= nNom - 1 && Y[k] >= GOAL_Y) { nUsed = k + 1; break; }
      }
      return finishRun(p, rd, nUsed, { X, Y, Psi, W1, W2, W3, R1, R2, R3, S1, S2, T, Tt, F, errRoad }, dIdeal);
    }
    function finishRun(p, rd, n, A, dIdeal) {
      const V = p.V, cut = (a) => a.subarray(0, n);
      const X = cut(A.X), Y = cut(A.Y), Psi = cut(A.Psi), W1 = cut(A.W1), W2 = cut(A.W2), W3 = cut(A.W3), R1 = cut(A.R1), R2 = cut(A.R2), R3 = cut(A.R3);
      const S1 = cut(A.S1), S2 = cut(A.S2), T = cut(A.T), Tt = cut(A.Tt), F = cut(A.F), errRoad = cut(A.errRoad);
      dIdeal = dIdeal.subarray(0, Math.min(dIdeal.length, n));
      const t = rd.t.subarray(0, n + 1);
      // results text
      let minY = Infinity, iF = 0;
      for (let i = 0; i < n; i++) { const v = Math.abs(Y[i] - GOAL_Y); if (v < minY) { minY = v; iF = i; } }
      let maxErr = 0; for (let i = 0; i < n; i++) if (errRoad[i] > maxErr) maxErr = errRoad[i];
      return { rd, n, t, X, Y, Psi, W1, W2, W3, R1, R2, R3, S1, S2, T, Tt, F, errRoad, dIdeal, minY, timeFinish: rd.t[iF], maxErr, V };
    }

    // MATLAB num2str(x,p) = sprintf('%.{p}g')
    function fmtG(x, p) {
      if (!isFinite(x)) return isNaN(x) ? "NaN" : (x < 0 ? "-Inf" : "Inf");
      if (x === 0) return "0";
      const e = Math.floor(Math.log10(Math.abs(Number(x.toPrecision(p)))));
      if (e < -4 || e >= p) { const [mm, ex] = x.toExponential(p - 1).split("e"); const m2 = mm.indexOf(".") >= 0 ? mm.replace(/0+$/, "").replace(/\.$/, "") : mm; const s = Number(ex); return m2 + "e" + (s < 0 ? "-" : "+") + String(Math.abs(s)).padStart(2, "0"); }
      let s = x.toFixed(Math.max(0, p - 1 - e)); if (s.indexOf(".") >= 0) s = s.replace(/0+$/, "").replace(/\.$/, ""); return s;
    }
    const inRange = (x, a, b) => x >= a && x <= b;
    function resultLines(p, r) {
      const out = [];
      if (r.minY < 2) out.push({ t: "time to finish = " + fmtG(r.timeFinish, 3) + " seconds" });
      else out.push({ t: "You did not finish the course! Try again." });
      out.push({ t: "max displacement from center of road = " + fmtG(r.maxErr, 2) + " meters" });
      if (r.maxErr > 1.0) out.push({ t: "Your car is off the road! try again", w: 1 });
      if (!inRange(p.Ki, 0, 500000) || !inRange(p.Kp, 0, 20000) || !inRange(p.Kd, 0, 2000)) { out.push({ t: "Your steering control gains are out of range!", w: 1 }); out.push({ t: "please use the sliders!", w: 1 }); }
      if (!inRange(p.KiV, 0, 100000) || !inRange(p.KpV, 0, 20000)) { out.push({ t: "Your velocity control gains are out of range!", w: 1 }); out.push({ t: "please use the sliders!", w: 1 }); }
      if (!inRange(p.V, 0, 100)) out.push({ t: "Your reference velocity is out of range!", w: 1 });
      return out;
    }

    // ---------------------------------------------------------------
    // Leaderboard helpers
    // ---------------------------------------------------------------
    const STEER_TYPES = ["PID (internal fdbk)", "PID", "PD (internal fdbk)", "PD"];
    const SPEED_TYPES = ["P", "PI", "PI (internal fdbk)"];
    // a run counts for the leaderboard only if it finishes, stays on the road and every setting is in range
    function checkRun(p, r) {
      if (!STEER_TYPES.includes(p.steer) || !SPEED_TYPES.includes(p.speed)) return { ok: false, reason: "unknown controller type" };
      if (!inRange(p.Ki, 0, 500000) || !inRange(p.Kp, 0, 20000) || !inRange(p.Kd, 0, 2000)) return { ok: false, reason: "steering gains are out of range" };
      if (!inRange(p.KiV, 0, 100000) || !inRange(p.KpV, 0, 20000)) return { ok: false, reason: "speed gains are out of range" };
      if (!(p.V > 0 && p.V <= 100)) return { ok: false, reason: "reference velocity is out of range" };
      if (!(r.minY < 2) || !isFinite(r.timeFinish)) return { ok: false, reason: "the car did not finish the course" };
      if (!(isFinite(r.maxErr) && r.maxErr <= 1.0)) return { ok: false, reason: "the car went off the road" };
      return { ok: true };
    }
    // team names: trimmed, inner spaces collapsed; matched ignoring capitals
    const cleanTeam = (s) => String(s || "").replace(/\s+/g, " ").trim().slice(0, 30);
    const teamKey = (s) => cleanTeam(s).toLowerCase();

    window.GW13FSim = { CAR, ROAD, SIM, simulate, setupRoad, fmtG, inRange, resultLines, checkRun, cleanTeam, teamKey, STEER_TYPES, SPEED_TYPES };
})();
