"use strict";
/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const vscode_debugadapter_1 = require("vscode-debugadapter");
const path_1 = require("path");
const xtRuntime_1 = require("./xtRuntime");
class XTDebugSession extends vscode_debugadapter_1.LoggingDebugSession {
    /**
     * Creates a new debug adapter that is used for one debug session.
     * We configure the default implementation of a debug adapter here.
     */
    constructor() {
        super("xt-debugger-debug.txt");
        this._variableHandles = new vscode_debugadapter_1.Handles();
        this.setDebuggerLinesStartAt1(false);
        this.setDebuggerColumnsStartAt1(false);
        this._runtime = new xtRuntime_1.XTRuntime();
        this._runtime.on('stopOnBreakpoint', () => {
            this.sendEvent(new vscode_debugadapter_1.StoppedEvent('breakpoint', XTDebugSession.THREAD_ID));
        });
        this._runtime.on('breakpointValidated', (bp) => {
            this.sendEvent(new vscode_debugadapter_1.BreakpointEvent('changed', { verified: bp.verified, id: bp.id }));
        });
        this._runtime.on('output', (text, filePath, line, column) => {
            const e = new vscode_debugadapter_1.OutputEvent(`${text}\n`);
            e.body.source = this.createSource(filePath);
            e.body.line = (parseInt(line) + 1) || 0;
            e.body.column = 0;
            this.sendEvent(e);
        });
        this._runtime.on('end', () => {
            this.sendEvent(new vscode_debugadapter_1.TerminatedEvent());
        });
    }
    initializeRequest(response, args) {
        this.sendEvent(new vscode_debugadapter_1.InitializedEvent());
        response.body = response.body || {};
        response.body.supportsEvaluateForHovers = false;
        response.body.supportsStepBack = false;
        this.sendResponse(response);
    }
    launchRequest(response, args) {
        this._runtime.start(args.program, false);
        this.sendResponse(response);
    }
    disconnectRequest(response, args) {
        this._runtime.stop();
        this.sendResponse(response);
    }
    setBreakPointsRequest(response, args) {
        const path = args.source.path;
        const clientLines = args.lines || [];
        this._runtime.clearBreakpoints(path);
        const actualBreakpoints = clientLines.map(l => {
            let { verified, line, id } = this._runtime.setBreakPoint(path, this.convertClientLineToDebugger(l));
            const bp = new vscode_debugadapter_1.Breakpoint(verified, this.convertDebuggerLineToClient(line));
            bp.id = id;
            return bp;
        });
        response.body = {
            breakpoints: actualBreakpoints
        };
        this.sendResponse(response);
    }
    threadsRequest(response) {
        response.body = {
            threads: [
                new vscode_debugadapter_1.Thread(XTDebugSession.THREAD_ID, "thread 1")
            ]
        };
        this.sendResponse(response);
    }
    stackTraceRequest(response, args) {
        const stk = this._runtime.stack();
        response.body = {
            stackFrames: stk.frames.map(f => new vscode_debugadapter_1.StackFrame(f.index, f.name, this.createSource(f.file), this.convertDebuggerLineToClient(f.line))),
            totalFrames: stk.count
        };
        this.sendResponse(response);
    }
    scopesRequest(response, args) {
        const frameReference = args.frameId;
        const scopes = new Array();
        scopes.push(new vscode_debugadapter_1.Scope("Variables", this._variableHandles.create("breakpoint_" + frameReference), false));
        response.body = {
            scopes: scopes
        };
        this.sendResponse(response);
    }
    variablesRequest(response, args) {
        const variables = new Array();
        const id = this._variableHandles.get(args.variablesReference);
        const makeVariables = (obj, prefix, valPrefix = "") => {
            if (obj instanceof Array) {
                obj.forEach((value, idx) => {
                    let valueDesc = value.toString();
                    if (value instanceof Array) {
                        valueDesc = "Array[" + value.length + "]";
                    }
                    variables.push({
                        name: valPrefix + idx.toString(),
                        type: typeof value,
                        value: valueDesc,
                        variablesReference: (typeof value === "object" ? this._variableHandles.create(prefix + idx.toString()) : 0)
                    });
                });
            }
            else {
                for (const key in obj) {
                    const value = obj[key];
                    let valueDesc = value.toString();
                    if (value instanceof Array) {
                        valueDesc = "Array[" + value.length + "]";
                    }
                    variables.push({
                        name: valPrefix + key,
                        type: typeof value,
                        value: valueDesc,
                        variablesReference: (typeof value === "object" ? this._variableHandles.create(prefix + key) : 0)
                    });
                }
            }
        };
        if (id.indexOf("breakpoint_") === 0) {
            makeVariables(this._runtime._breakingScopeVariables, "object_scope_");
            makeVariables(this._runtime._breakingThisVariables, "object_this_", "this.");
        }
        else if (id.indexOf("object_scope_") === 0) {
            try {
                const components = id.split("_");
                let obj = this._runtime._breakingScopeVariables;
                components.forEach((it, idx) => {
                    if (idx > 1) {
                        if (obj instanceof Array) {
                            obj = obj[parseInt(it)];
                        }
                        else {
                            obj = obj[it];
                        }
                    }
                });
                makeVariables(obj, id + "_");
            }
            catch (error) { }
        }
        else if (id.indexOf("object_this_") === 0) {
            try {
                const components = id.split("_");
                let obj = this._runtime._breakingThisVariables;
                components.forEach((it, idx) => {
                    if (idx > 1) {
                        if (obj instanceof Array) {
                            obj = obj[parseInt(it)];
                        }
                        else {
                            obj = obj[it];
                        }
                    }
                });
                makeVariables(obj, id + "_");
            }
            catch (error) { }
        }
        response.body = {
            variables: variables
        };
        this.sendResponse(response);
    }
    continueRequest(response, args) {
        this._runtime.continue();
        this.sendResponse(response);
    }
    stepInRequest(response, args) {
        this._runtime.step();
        this.sendResponse(response);
    }
    stepOutRequest(response, args) {
        this._runtime.step();
        this.sendResponse(response);
    }
    nextRequest(response, args) {
        this._runtime.step();
        this.sendResponse(response);
    }
    evaluateRequest(response, args) {
        let reply = undefined;
        if (args.context === 'repl') {
            this._runtime.eval(args.expression);
        }
        response.body = {
            result: reply ? reply : `evaluate(context: '${args.context}', '${args.expression}')`,
            variablesReference: 0
        };
        this.sendResponse(response);
    }
    createSource(filePath) {
        return new vscode_debugadapter_1.Source(path_1.basename(filePath), this.convertDebuggerPathToClient(filePath), undefined, undefined, 'mock-adapter-data');
    }
}
XTDebugSession.THREAD_ID = 1;
vscode_debugadapter_1.DebugSession.run(XTDebugSession);
//# sourceMappingURL=xtDebug.js.map