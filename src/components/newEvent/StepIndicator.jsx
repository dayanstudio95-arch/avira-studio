import React from 'react';
import { Check } from "lucide-react";

export default function StepIndicator({ steps, currentStep }) {
  return (
    <div className="flex items-center justify-center mb-8">
      {steps.map((step, index) => (
        <div key={step.number} className="flex items-center">
          <div className="flex flex-col items-center">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center font-semibold transition-all duration-300 ${
              step.number < currentStep 
                ? 'bg-green-500 text-gray-900' 
                : step.number === currentStep 
                ? 'bg-yellow-400 text-gray-900' 
                : 'bg-gray-800 text-gray-400 border-2 border-gray-700'
            }`}>
              {step.number < currentStep ? (
                <Check className="w-6 h-6" />
              ) : (
                step.number
              )}
            </div>
            <div className="mt-2 text-center">
              <p className={`text-sm font-medium ${
                step.number <= currentStep ? 'text-white' : 'text-gray-500'
              }`}>
                {step.title}
              </p>
              <p className="text-xs text-gray-500">{step.description}</p>
            </div>
          </div>
          
          {index < steps.length - 1 && (
            <div className={`w-16 h-1 mx-4 mt-6 transition-all duration-300 ${
              step.number < currentStep ? 'bg-green-500' : 'bg-gray-800'
            }`} />
          )}
        </div>
      ))}
    </div>
  );
}