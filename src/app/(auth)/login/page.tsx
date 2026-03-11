"use client";

import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Mail, LockKeyhole, Eye, EyeOff } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

export default function LoginPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pressed, setPressed] = useState(false); //added state for button press
  const [showPassword, setShowPassword] = useState(false);

  const login = async () => {
    setPressed(true);
    setTimeout(() => {
    setPressed(false);       
    }, 200);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      router.push("/dashboard");
    } catch (err: any) {
      showToast(err.message || "Login failed. Please try again.", "error");
    }
  };

  return (
    <div className="flex bg-[#F1F7FF] h-screen">
      <div className="w-[50%] flex items-center">
        <div className="w-[400px] flex flex-col ml-[120px]">

          {/* Logo + System Title */}
          <div className="flex items-center gap-3 mb-4">
            <img src="/Logo.svg" alt="Logo" className="w-[48px] h-[48px]" style={{ filter: "invert(29%) sepia(56%) saturate(800%) hue-rotate(200deg) brightness(80%) contrast(95%)" }} />
            <span className="text-[23px] font-semibold text-[#3759C1] leading-tight">
              Inventory Management System
            </span>
          </div>

          <h1 className="text-[19px] text-[#0E1323] mb-[40px] font-semibold">Welcome Back</h1>

          {/* Email Input */}
          <div className="relative w-full mb-0">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#3759C1] pointer-events-none">
              <Mail size={16} />
            </span>
            <input
              className="bg-[#F1F7FF]
                border
                border-[#3759C1]
                border-[1px]
                shadow-[0_0_10px_rgba(55,89,193,0.25)]
                pl-9
                pr-4
                py-2
                w-full
                h-[40px]
                rounded-md
                text-[#0E132380]
                "
              placeholder="Email"
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          {/* Password Input */}
          <div className="relative w-full mt-[40px] mb-[50px]">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#3759C1] pointer-events-none">
              <LockKeyhole size={16} />
            </span>
            <input
              className="bg-[#F1F7FF]
                border
                border-[#3759C1]
                border-[1px]
                shadow-[0_0_10px_rgba(55,89,193,0.25)]
                pl-9
                pr-10
                py-2
                h-[40px]
                w-full
                rounded-md
                text-[#0E132380]"
              type={showPassword ? "text" : "password"}
              placeholder="Password"
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#3759C1] cursor-pointer"
              tabIndex={-1}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          <div className="relative"> 
            <button
              onClick={login}
              className={`bg-[#1D2937] text-[#F1F7FF] font-normal text-[18px] block mx-auto w-[100px] h-[40px] rounded-[10px] relative z-10
                transition-transform
                duration-200
                ease-in-out
                cursor-pointer
                ${pressed ? "translate-y-0" : "-translate-y-[12px]"}
              `}
              >
              Login
            </button>
            <div className="block mx-auto w-[100px] h-[40px] rounded-[10px] shadow-[inset_0_0_0_7px_#1D2937] absolute top-0 left-0 right-0 bottom-0"></div>
          </div> 
        </div>
      </div>
      <div className="w-[50%] bg-[#fff] pb-[50px] flex items-center justify-center">
        <img src="images/Inventroy-img.jpg" alt="Login background" className="object-cover" />
      </div>
    </div>

  );
}