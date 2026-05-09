import { BrowserRouter, Route, Routes } from "react-router-dom";
import OrderDetail from "./orders/OrderDetail";
import ShiftView from "./shifts/ShiftView";
import Home from "./routes/Home";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/orders/:orderId" element={<OrderDetail />} />
        <Route path="/shifts" element={<ShiftView />} />
      </Routes>
    </BrowserRouter>
  );
}
