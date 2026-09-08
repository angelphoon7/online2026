#!/usr/bin/env bash
# Cross — Gate 0.5 preflight
#
# Determines whether the resolved @1inch/swap-vm actually contains the mechanism
# Cross depends on. Blocking: do not write contract code until this passes.
#
# Usage:  ./scripts/preflight.sh [path-to-swap-vm]
# Default search order: lib/swap-vm, node_modules/@1inch/swap-vm

set -uo pipefail

SVM="${1:-}"
if [[ -z "$SVM" ]]; then
  for c in lib/swap-vm node_modules/@1inch/swap-vm; do
    [[ -d "$c" ]] && SVM="$c" && break
  done
fi

if [[ -z "$SVM" || ! -d "$SVM" ]]; then
  echo "FATAL: swap-vm not found. Install it first:"
  echo "  forge install 1inch/swap-vm"
  echo "  # or: yarn add @1inch/swap-vm @1inch/aqua @1inch/solidity-utils"
  exit 2
fi

echo "swap-vm path : $SVM"
[[ -f "$SVM/package.json" ]] && \
  echo "package ver  : $(grep -m1 -oE '"version"[^,]*' "$SVM/package.json")"
if [[ -d "$SVM/.git" ]]; then
  echo "commit       : $(git -C "$SVM" log -1 --format='%H %ad' --date=short 2>/dev/null)"
  echo "ref          : $(git -C "$SVM" rev-parse --abbrev-ref HEAD 2>/dev/null)"
fi
echo

FAIL=0
BLOCK=0

check() { # name path pattern blocking note
  local name="$1" path="$2" pat="$3" blocking="$4" note="$5"
  if [[ ! -f "$SVM/$path" ]]; then
    printf '  %-34s MISSING FILE  (%s)\n' "$name" "$path"
    FAIL=1; [[ "$blocking" == "block" ]] && BLOCK=1
    return
  fi
  local n
  n=$(grep -c -- "$pat" "$SVM/$path" 2>/dev/null || echo 0)
  if [[ "$n" -gt 0 ]]; then
    printf '  %-34s OK (%s)\n' "$name" "$n"
  else
    printf '  %-34s ABSENT        %s\n' "$name" "$note"
    FAIL=1; [[ "$blocking" == "block" ]] && BLOCK=1
  fi
}

echo "BLOCKING — the mechanism does not exist without these"
check "XYCConcentrate output cap"   "src/instructions/XYCConcentrate.sol" \
      "Partial fill support"        block "no partial fill on this path"
check "XYCConcentrate has exec()"   "src/instructions/XYCConcentrate.sol" \
      "function exec"               block "balance transform only, not a pricing instruction"
echo

echo "REQUIRED — fixture and dispatch depend on these"
check "TakerTraits.allowPartialFill" "src/libs/TakerTraits.sol" \
      "allowPartialFill"             warn  "exact-in enforces takerAmount == amountIn"
check "threshold scales on partial"  "src/libs/TakerTraits.sol" \
      "thresholdAmount.mulDiv"       warn  "minOut must be set below the resized output"
check "OpcodeList.sol / _92 slot"    "src/libs/OpcodeList.sol" \
      "_92"                          warn  "different opcode model; Opcode._92 will not compile"
echo

echo "EXPECTED — relied on by the spec"
check "require(amountOut > 0)"       "src/libs/TakerTraits.sol" \
      "AmountOutMustBeGreaterThanZero" warn "zero-fill representability differs"
check "setNextPC helper"             "src/libs/VM.sol" \
      "function setNextPC"           warn  "no way to halt a program early"
check "Decay runLoop pattern"        "src/instructions/Decay.sol" \
      "ctx.runLoop()"                warn  "stateful-instruction precedent absent"
echo

if [[ "$BLOCK" -eq 1 ]]; then
  cat <<'EOF'
VERDICT: BLOCKED

The resolved version has no partial-fill capable concentrate path, so REVERT to RESIZE
cannot be demonstrated on it. This is not a configuration problem.

Two options:
  1. Repin to a version that has it. The hackathon rules permit redeploying a modified
     SwapVM, so the pin is your choice:
         forge install 1inch/swap-vm@main
     Re-run this script afterwards.
  2. Choose a different hero pricing instruction that supports partial fill natively,
     and update the spec's hero-program choice.

Do not write contract code until this passes. Report the verdict to the user first.
EOF
  exit 1
fi

if [[ "$FAIL" -eq 1 ]]; then
  cat <<'EOF'
VERDICT: PROCEED WITH ADJUSTMENTS

The blocking mechanism is present, but some expected capabilities are absent. Adjust the
fixture to what this version actually provides:

  - no allowPartialFill  -> exact-in may already permit takerAmount >= amountIn; check
                            TakerTraits.validate directly and drop the flag from the fixture
  - no threshold scaling -> set minOut below the expected resized output, it will not adapt
  - no OpcodeList        -> the opcode model differs; find how instructions are dispatched
                            in this version before writing CrossOpcodes

Record what you found in the README before continuing.
EOF
  exit 0
fi

cat <<'EOF'
VERDICT: CLEAR

All capabilities present. Proceed in order:
  1. walking skeleton  — router with a pass-through opcode, one real ERC-20 swap
  2. CROSS_XD minimal  — coverage read plus proportional resize, nothing else
  3. calibrate bounds  — sweep sqrtPriceMin/Max so the control arm overshoots balanceOut
  4. test_fromRevertToResize

Record the version and commit in the README now, while you have them.
EOF
exit 0
