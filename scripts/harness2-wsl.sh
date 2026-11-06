#!/usr/bin/env bash
set -euo pipefail
mode="${1:-check}"
if [[ "$(id -u)" == 0 ]]; then
  echo 'Harness2 WSL requires a non-root Ubuntu user.' >&2
  exit 2
fi
for command in python3.12 bwrap prlimit timeout; do
  command -v "$command" >/dev/null || { echo "Missing Ubuntu dependency: $command" >&2; exit 2; }
done
python3.12 -I -c 'import sys; assert sys.version_info[:2] == (3,12)'
work=$(mktemp -d /tmp/agenthub-harness2.XXXXXXXX)
trap 'rm -rf -- "$work"' EXIT
mkdir "$work/official"
if [[ "$mode" == demo ]]; then
  source_path=$(wslpath -u "$2")
  cp -R -- "$source_path/." "$work/official/"
  chmod -R a+rX "$work/official"
fi
bindings=(--ro-bind /usr /usr --ro-bind /bin /bin --ro-bind /lib /lib)
[[ ! -d /lib64 ]] || bindings+=(--ro-bind /lib64 /lib64)
[[ ! -f /etc/ld.so.cache ]] || bindings+=(--ro-bind /etc/ld.so.cache /etc/ld.so.cache)
policy=(
  --die-with-parent --new-session --unshare-all --cap-drop ALL
  --proc /proc --dev /dev --tmpfs /tmp --tmpfs /output
  --ro-bind "$work/official" /official --chdir /output
  --clearenv --setenv PATH /usr/bin:/bin --setenv HOME /tmp
)
if [[ "$mode" == check ]]; then
  script='import os,sys,socket; assert os.geteuid()!=0; assert sys.version_info[:2]==(3,12); assert not os.path.exists("/mnt/c"); assert not os.path.exists("/init"); assert not os.path.exists("/home"); s=socket.socket(); s.settimeout(.1)
try: s.connect(("1.1.1.1",80))
except OSError: pass
else: raise RuntimeError("Network isolation failed")
try: open("/usr/harness2-write-check","w")
except OSError: pass
else: raise RuntimeError("Read-only runtime failed")
print("HARNESS2_WSL_ISOLATION_OK")'
elif [[ "$mode" == demo ]]; then
  script='import sys,runpy,json;sys.path.insert(0,"/official");sys.argv=["harness2-demo","--output","/output/demo","--k","2","--mode","both"]
try: runpy.run_module("harness2.cli.demo",run_name="__main__")
except SystemExit as e:
 if e.code: raise
print("HARNESS2_REPORT="+open("/output/demo/demo.json").read().replace("\n",""))'
else
  echo 'Unsupported WSL workload. Only isolation check and official demo are allowed.' >&2
  exit 2
fi
timeout --kill-after=5s 120s prlimit --as=1073741824 --cpu=100 --nproc=64 --nofile=128 --fsize=67108864 -- +  bwrap "${bindings[@]}" "${policy[@]}" python3.12 -I -B -c "$script"
