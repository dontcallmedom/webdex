const list = [...document.getElementById("terms").querySelectorAll("li")].map(n => {
  const term = n.querySelector(".term").textContent;
  const freq = parseInt(n.querySelector(".freq").textContent, 10);
  return [term, freq];
});
console.log(list);
WordCloud(document.getElementById('cloud'), { list, gridSize: 18, backgroundColor: '#fafafa' } );
