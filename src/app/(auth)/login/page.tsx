"use client";

import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pressed, setPressed] = useState(false); //added state for button press

  const login = async () => {
    setPressed(true);
    setTimeout(() => {
    setPressed(false);       
    }, 200);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      router.push("/dashboard");
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div className="flex bg-[#F1F7FF] h-screen">
      <div className="w-[50%] flex items-center">
        <div className="w-[400px] flex flex-col ml-[120px]">
          <h1 className="text-[40px] text-[#0E1323] mb-[40px] font-semibold">Welcome Back</h1>

          <input
            className="bg-[#F1F7FF]
              border
              border-[#3759C1]
              border-[1px]
              shadow-[0_0_10px_rgba(55,89,193,0.25)]
              px-4
              py-2
              w-full
              h-[40px]
              rounded-md
              text-[#0E132380]
              "
            placeholder="Email"
            onChange={(e) => setEmail(e.target.value)}
            />

          <input
            className="bg-[#F1F7FF]
              border
              border-[#3759C1]
              border-[1px]
              shadow-[0_0_10px_rgba(55,89,193,0.25)]
              px-4
              py-2
              h-[40px]
              w-full
              rounded-md
              text-[#0E132380]
              mt-[40px]
              mb-[50px]"
            type="password"
            placeholder="Password"
            onChange={(e) => setPassword(e.target.value)}
            />
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