// SPDX-FileCopyrightText: 2026 BrokenShine <xchai404@gmail.com>
//
// SPDX-License-Identifier: MIT

/**
 * dsh-atelier-agent 客户端半边 — Web / Electron 桌面共用。
 *
 * 在会话视图注册一个 "Peers" 页：读宿主 RPC 的 peer 列表与实时输出，
 * 提供 send / focus / close / recover。状态真相全在宿主文件契约，客户端
 * 只持有 selectedPeer 与轮询结果，不做本地缓存。
 *
 * 手写 __ModuleLoader__ 的 CJS factory（与官方 client 模块同一装载协议，
 * 无构建）；react 由客户端模块系统作为 external 提供。
 */

window.__ModuleLoader__.load({
  id: "dsh-atelier-agent",
  factory: function (require) {
    var module = { exports: {} };
    var React = require("react");
    var useState = React.useState;
    var useEffect = React.useEffect;

    var NAME = "dsh-atelier-agent/client";
    var INJECT = ["slots", "connection"];
    var CHANNEL = "/dsh-atelier";

    var colors = {
      bg: "var(--dsw-alias-bg-layer-1, #111)",
      layer: "var(--dsw-alias-bg-layer-2, #1a1a1a)",
      border: "var(--dsw-alias-border-l2, #333)",
      text: "var(--dsw-alias-label-primary, #eee)",
      dim: "var(--dsw-alias-label-secondary, #999)",
      brand: "var(--dsw-alias-brand-primary, #4c9aff)",
      ok: "var(--dsw-alias-state-success-primary, #3fb950)",
      err: "var(--dsw-alias-state-error-primary, #f85149)",
    };

    var mono = "var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)";

    function apply(ctx) {
      function call(endpoint, payload) {
        return ctx.connection.rpc.call(CHANNEL, endpoint, payload).then(function (res) {
          if (!res || res.ok !== true) {
            var message = res && res.error && res.error.message;
            throw new Error(message || "rpc failed: " + endpoint);
          }
          return res.value;
        });
      }

      function Panel() {
        var peersState = useState([]);
        var peers = peersState[0];
        var setPeers = peersState[1];
        var agentsState = useState([]);
        var agents = agentsState[0];
        var setAgents = agentsState[1];
        var selState = useState(null);
        var selected = selState[0];
        var setSelected = selState[1];
        var tailState = useState("");
        var tail = tailState[0];
        var setTail = tailState[1];
        var errState = useState("");
        var err = errState[0];
        var setErr = errState[1];
        var textState = useState("");
        var text = textState[0];
        var setText = textState[1];

        useEffect(function () {
          var alive = true;
          function tick() {
            call("peers", {})
              .then(function (value) {
                if (!alive) return;
                setPeers(value.peers || []);
                setAgents(value.agents || []);
                setErr("");
              })
              .catch(function (e) {
                if (alive) setErr(String((e && e.message) || e));
              });
          }
          tick();
          var iv = setInterval(tick, 2000);
          return function () {
            alive = false;
            clearInterval(iv);
          };
        }, []);

        useEffect(function () {
          if (!selected) {
            setTail("");
            return;
          }
          var alive = true;
          function tick() {
            call("tail", { id: selected, lines: 80 })
              .then(function (value) {
                if (alive) setTail(value.output || "");
              })
              .catch(function (e) {
                if (alive) setErr(String((e && e.message) || e));
              });
          }
          tick();
          var iv = setInterval(tick, 2000);
          return function () {
            alive = false;
            clearInterval(iv);
          };
        }, [selected]);

        function act(endpoint, payload) {
          return call(endpoint, payload).catch(function (e) {
            setErr(String((e && e.message) || e));
          });
        }

        function send() {
          var value = text.trim();
          if (!selected || !value) return;
          act("send", { id: selected, text: value }).then(function () {
            setText("");
          });
        }

        var peerRows = peers.map(function (p) {
          var active = p.peerId === selected;
          return React.createElement(
            "button",
            {
              key: p.peerId,
              type: "button",
              onClick: function () {
                setSelected(p.peerId);
              },
              style: {
                display: "flex",
                alignItems: "baseline",
                gap: "8px",
                width: "100%",
                textAlign: "left",
                padding: "6px 8px",
                borderRadius: "6px",
                border: "1px solid " + (active ? colors.brand : "transparent"),
                background: active ? colors.layer : "transparent",
                color: colors.text,
                cursor: "pointer",
                font: "inherit",
              },
            },
            React.createElement(
              "span",
              { style: { color: p.busy ? colors.ok : colors.dim, flex: "none" } },
              p.busy ? "●" : "○",
            ),
            React.createElement(
              "span",
              { style: { fontFamily: mono, fontSize: "12px", flex: "none" } },
              p.peerId,
            ),
            React.createElement(
              "span",
              { style: { color: colors.dim, fontSize: "12px", flex: "1", minWidth: 0 } },
              p.agent + " @ " + p.harness,
            ),
            React.createElement(
              "span",
              { style: { color: colors.dim, fontSize: "11px", flex: "none" } },
              p.busy ? "busy #" + p.msgSeq : p.recover,
            ),
          );
        });

        return React.createElement(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "column",
              height: "100%",
              minHeight: 0,
              padding: "16px",
              gap: "12px",
              background: colors.bg,
              color: colors.text,
            },
          },
          React.createElement(
            "div",
            { style: { display: "flex", alignItems: "baseline", gap: "12px" } },
            React.createElement("h2", { style: { margin: 0, fontSize: "16px" } }, "Agent Peers"),
            React.createElement(
              "span",
              { style: { color: colors.dim, fontSize: "12px" } },
              peers.length + " alive · " + agents.length + " agents",
            ),
            React.createElement(
              "button",
              {
                type: "button",
                onClick: function () {
                  act("recover", {});
                },
                style: {
                  marginLeft: "auto",
                  border: "1px solid " + colors.border,
                  background: "transparent",
                  color: colors.dim,
                  borderRadius: "6px",
                  padding: "2px 8px",
                  cursor: "pointer",
                  font: "inherit",
                  fontSize: "12px",
                },
              },
              "回收孤儿",
            ),
          ),
          err
            ? React.createElement(
                "div",
                { style: { color: colors.err, fontSize: "12px" } },
                err,
              )
            : null,
          React.createElement(
            "div",
            { style: { display: "flex", gap: "12px", flex: 1, minHeight: 0 } },
            React.createElement(
              "div",
              {
                style: {
                  width: "52%",
                  minWidth: 0,
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: "2px",
                },
              },
              peerRows.length > 0
                ? peerRows
                : React.createElement(
                    "div",
                    { style: { color: colors.dim, fontSize: "13px", padding: "8px" } },
                    "还没有 peer。让模型调用 peer({agent,task}) 派发，或先看 agent 清单。",
                  ),
            ),
            React.createElement(
              "div",
              {
                style: {
                  flex: 1,
                  minWidth: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                },
              },
              selected
                ? React.createElement(
                    "div",
                    { style: { display: "flex", gap: "8px", alignItems: "center" } },
                    React.createElement(
                      "span",
                      { style: { fontFamily: mono, fontSize: "12px" } },
                      selected,
                    ),
                    React.createElement(
                      "button",
                      {
                        type: "button",
                        onClick: function () {
                          act("focus", { id: selected });
                        },
                        style: actionStyle(),
                      },
                      "聚焦 pane",
                    ),
                    React.createElement(
                      "button",
                      {
                        type: "button",
                        onClick: function () {
                          act("close", { id: selected }).then(function () {
                            setSelected(null);
                          });
                        },
                        style: actionStyle(),
                      },
                      "退役",
                    ),
                  )
                : null,
              React.createElement(
                "pre",
                {
                  style: {
                    flex: 1,
                    minHeight: 0,
                    overflow: "auto",
                    margin: 0,
                    padding: "10px",
                    borderRadius: "8px",
                    border: "1px solid " + colors.border,
                    background: colors.layer,
                    color: colors.text,
                    fontFamily: mono,
                    fontSize: "12px",
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                  },
                },
                selected ? tail || "(no output)" : "选择左侧 peer 查看实时输出。",
              ),
              React.createElement(
                "div",
                { style: { display: "flex", gap: "8px" } },
                React.createElement("input", {
                  value: text,
                  onChange: function (e) {
                    setText(e.target.value);
                  },
                  onKeyDown: function (e) {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  },
                  placeholder: selected ? "给该 peer 追加指令（舵手/新任务）…" : "先选择 peer",
                  disabled: !selected,
                  style: {
                    flex: 1,
                    minWidth: 0,
                    padding: "6px 10px",
                    borderRadius: "6px",
                    border: "1px solid " + colors.border,
                    background: colors.layer,
                    color: colors.text,
                    font: "inherit",
                    fontSize: "13px",
                  },
                }),
                React.createElement(
                  "button",
                  {
                    type: "button",
                    onClick: send,
                    disabled: !selected || !text.trim(),
                    style: actionStyle(),
                  },
                  "发送",
                ),
              ),
            ),
          ),
        );
      }

      function actionStyle() {
        return {
          border: "1px solid " + colors.border,
          background: "transparent",
          color: colors.dim,
          borderRadius: "6px",
          padding: "3px 10px",
          cursor: "pointer",
          font: "inherit",
          fontSize: "12px",
          flex: "none",
        };
      }

      ctx.slots.inject("conversation.view", function () {
        return ctx.slots.register(
          {
            name: "conversation.view",
            id: "atelier-peers",
            order: 40,
            label: function () {
              return "Peers";
            },
          },
          Panel,
        );
      });
    }

    module.exports = { name: NAME, inject: INJECT, apply: apply };
    return module.exports;
  },
});
