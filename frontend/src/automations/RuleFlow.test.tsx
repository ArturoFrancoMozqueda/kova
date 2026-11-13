import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { RuleFlow } from "./RuleFlow";

const rule = { template_key: "order_ready", title: "Pedido listo para entregar", description: "", enabled: false, version: 0 };

it("draws the trigger and the exact internal task the rule creates", () => {
  render(<RuleFlow rule={{ ...rule, task: "Revisa la entrega del pedido listo" }} />);
  const flow = screen.getByRole("list", { name: "Cómo funciona: Pedido listo para entregar" });
  expect(flow).toHaveTextContent("CuandoUn pedido se marca como listo");
  expect(flow).toHaveTextContent("Entonces aparece en PendientesRevisa la entrega del pedido listo");
});

it("stays honest for older responses and unknown templates", () => {
  render(<RuleFlow rule={{ ...rule, template_key: "future_rule" }} />);
  const flow = screen.getByRole("list");
  expect(flow).toHaveTextContent("Ocurre el evento de la regla");
  expect(flow).toHaveTextContent("Una tarea interna para tu equipo");
  expect(flow).not.toHaveTextContent("future_rule");
});
