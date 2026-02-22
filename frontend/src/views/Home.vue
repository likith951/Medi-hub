<script>
export default{
    data()
    {
        return{
            name:'',
            phno:'',
            bloodgroup:''
        }
    }
}

</script>
<template>
  <div class="min-h-screen bg-gray-100 flex items-center justify-center">
    <div class="bg-white p-8 rounded-lg shadow-md w-96">
      
      <h1 class="text-2xl font-bold text-blue-600 mb-6 text-center">MediLocker</h1>

      <input
        v-model="name"
        type="text"
        placeholder="Enter your name"
        class="border p-2 rounded w-full mb-4 focus:outline-none focus:border-blue-600"
      />

      <input
        v-model="phno"
        type="text"
        placeholder="Enter phone number"
        class="border p-2 rounded w-full mb-4 focus:outline-none focus:border-blue-600"
      />

      <input
        v-model="bloodgroup"
        type="text"
        placeholder="Blood Group"
        class="border p-2 rounded w-full mb-6 focus:outline-none focus:border-blue-600"
      />

      <button class="bg-blue-600 text-white p-2 rounded w-full font-semibold hover:bg-blue-700">
        Submit
      </button>

      <div class="mt-4 text-gray-500 text-sm">
        <p>Name: {{ name }}</p>
        <p>Phone: {{ phno }}</p>
      </div>

    </div>
  </div>
</template>
