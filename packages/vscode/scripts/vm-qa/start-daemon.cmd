@echo off
rem Scratch Paseo daemon for VM QA: run-local home, loopback listen, no relay or MCP.
rem   start-daemon.cmd <name> <port> [password]
set "ROOT=%~dp0"
set "PASEO_HOME=%ROOT%home-%~1"
set "PASEO_LISTEN=127.0.0.1:%~2"
set "PASEO_PASSWORD=%~3"
rem Development mode registers the deterministic `mock` provider used by seed-agent.mjs.
set "NODE_ENV=development"
set "PASEO_NODE_ENV=development"
set "PASEO_LOCAL_SPEECH_AUTO_DOWNLOAD=0"
set "PASEO_DICTATION_ENABLED=0"
set "PASEO_VOICE_MODE_ENABLED=0"
set "PATH=%ROOT%git\cmd;%ROOT%node;%PATH%"
title Paseo QA daemon %~1 %~2
if not exist "%PASEO_HOME%" mkdir "%PASEO_HOME%"
> "%PASEO_HOME%\config.json" echo {"daemon":{"listen":"127.0.0.1:%~2"}}
"%ROOT%node\node.exe" "%ROOT%daemon\node_modules\@getpaseo\server\dist\server\server\daemon-worker.js" --no-relay --no-mcp > "%ROOT%daemon-%~1.log" 2>&1
