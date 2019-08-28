
import * as Comlink from "./node_modules/comlink/dist/esm/comlink.mjs";
//const Backend = Comlink.wrap(new Worker("./worker.js", { type: "module" }));
const Backend = Comlink.wrap(new Worker("./worker.js"));

const SAMPLE_DATA = [
	{
		"real": 0.9272064644381,
		"imag": -0.3014399089958,
		"freq": 100000000
	},
	{
		"real": 0.9229223881977,
		"imag": -0.3083542170549,
		"freq": 100990099
	},
	{
		"real": 0.9183366235677,
		"imag": -0.3154605235413,
		"freq": 101980198
	},
];

Vue.use(VueMaterial.default);

function colorGen(h, s, l, i) {
	if (!h) h = 0;
	if (!s) s = 60;
	if (!l) l = 55;
	if (!i) i = 53;
	return function () {
		const ret = `hsl(${h}, ${s}%, ${l}%)`;
		h = (h + i) % 360;
		return ret;
	};
}

function calcLogMag(i) {
	return Math.log10(Math.hypot(i.real, i.imag)) * 20
}

function calcSWR(i) {
	const x = Math.hypot(i.real, i.imag);
	if (x > 1) return 1/0;
	return (1 + x) / (1 - x);
}

function calcPhase(i) {
	return 2 * Math.atan2(i.real, i.imag) / Math.PI * 90;
}

function calcZ(i) {
	const z0 = 50;
	const d = z0 / ((1-i.real)*(1-i.real)+i.imag*i.imag); 
	const zr = ((1+i.real)*(1-i.real) - i.imag*i.imag) * d;  
	const zi = 2*i.imag * d;
	return [zr, zi];
}

function calcLinear(i) {
	return Math.hypot(i.real, i.imag);
}

function calcReal(i) {
	return i.real;
}

function calcImag(i) {
	return i.imag;
}

function calcZabs(i) {
	return Math.hypot(...calcZ(i));
}

function calcZR(i) {
	return calcZ(i)[0];
}

function calcZX(i) {
	return calcZ(i)[1];
}

function calcZr(i) {
	const d = ((1-i.real)*(1-i.real)+i.imag*i.imag);  
	const zr = ((1+i.real)*(1-i.real) - i.imag*i.imag) / d;
	const zi = 2*i.imag / d;
	return {
		freq: i.freq,
		real: zr,
		imag: zi
	};
}

new Vue({
	el: "#app",
	data: {
		status: 'disconnected',
		snackbar: {
			show: false,
			message: ""
		},
		alert: {
			show: false,
			title: "",
			content: ""
		},
		graph: "",
		menuVisible: false,

		traces: [
		],

		showTraceDialog: false,
		currentTraceSetting: {
			show: true,
			channel: 0,
			format: 'smith'
		},

		freqInputSelect: "start-stop",

		updating: false,

		showCalibrationDialog: false,

		capturing: false,
		captureDownloadHref: "",
		showCaptureDialog: false,

		showAboutDialog: false,

		calibrationRunning: false,
		calibrationStep: "reset",

		showSmithChart: true,
		showFreqChart: false,
		availableSmithChart: true,
		availableFreqChart: true,
		graphSelected: 'smith',

		showTDRDialog: false,
		velocityOfSignalPropagation: 70,
		peakTDR: 0,

		data: {
			ch0: [],
			ch1: []
		},

		deviceInfo: {
			version: null
		},

		autoUpdate: 1000,

		range: {
			focusing: "",
			start: 0,
			stop: 900,
			center: 450,
			span: 900
		}
	},

	computed: {
		connected: function () {
			return this.status === 'connected';
		},

		disconnected: function () {
			return this.status === 'disconnected';
		}
	},

	methods: {
		test: function () {
		},

		connect: async function (device0) {
			const device = device0 || await NanoVNA.requestDevice();
			if (device) {
				// for debug
				window.Backend = this.backend;

				this.status = 'connecting'
				const connected = await this.backend.open({
					vendorId: device.vendorId,
					productId: device.productId,
					serialNumber: device.serialNumber,
				});
				if (!connected) {
					console.log('failed to open');
					return;
				}

				this.deviceInfo.version = await this.backend.getVersion();
				this.status = 'connected';

				this.update();
			}
		},

		disconnect: async function () {
			this.backend.close();
			this.status = 'disconnected';
		},

		update: async function () {
			this.updating = true;
			const freqs = await this.backend.getFrequencies();
			const start = freqs[0], stop = freqs[freqs.length-1];
			const span   = stop - start;
			const center = span / 2 + start;
			console.log({start, stop, span, center});
			this.range.start = start / 1e6;
			this.range.stop = stop / 1e6;
			this.range.span = span / 1e6;
			this.range.center = center / 1e6;

			const measured0 = await this.backend.getData(0);

			this.data.ch0 = measured0.map( (complex, i) => ({
				freq: freqs[i],
				real: complex[0],
				imag: complex[1],
			}));

			const measured1 = await this.backend.getData(1);
			this.data.ch1 = measured1.map( (complex, i) => ({
				freq: freqs[i],
				real: complex[0],
				imag: complex[1],
			}));
			this.updating = false;

			if (this.autoUpdate) {
				this.autoUpdateTimer = setTimeout(() => {
					this.update();
				}, this.autoUpdate);
			}
		},

		pause: async function () {
			clearTimeout(this.autoUpdateTimer);
			this.autoUpdate = 0;
			// await this.backend.doPause();
		},

		resume: function () {
			this.autoUpdate = 1000;
			this.update();
		},

		saveAs: function (format) {
			if (format === 's1p') {
				const body = [];
				body.push('# Hz S RI R 50\n');
				this.data.ch0.forEach( (d) => {
					body.push(`${d.freq}\t${d.real}\t${d.imag}\n`);
				});
				const blob = new Blob(body, { type: 'application/octet-stream' });
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = 'nanovna.s1p';
				a.click();
			} else
			if (format === 's2p') {
				const body = [];
				body.push('# Hz S RI R 50\n');
				this.data.ch0.forEach( (ch0, i) => {
					const ch1 = this.data.ch1[i];
					// XXX treat S12 == S21, S22 = S11
					body.push(`${ch0.freq}\t${ch0.real}\t${ch0.imag}\t${ch1.real}\t${ch1.imag}\t${ch1.real}\t${ch1.imag}\t${ch0.real}\t${ch0.imag}\n`);
				});
				const blob = new Blob(body, { type: 'application/octet-stream' });
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = 'nanovna.s2p';
				a.click();
			} else {
				alert('not implemented');
			}
		},

		saveAsPng: function (graph) {
			const canvas = this.$refs[graph];
			canvas.toBlob((blob) => {
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = this.graph + '.png';
				a.click();
			});
		},

		calibration: async function (step, argv) {
			this.calibrationRunning = true;
			if (step === 'reset') {
				await this.backend.doCal('reset');
				this.calibrationStep = 'open';
			} else
			if (step === 'open') {
				await this.backend.doCal('open');
				this.calibrationStep = 'short';
			} else
			if (step === 'short') {
				await this.backend.doCal('short');
				this.calibrationStep = 'load';
			} else 
			if (step === 'load') {
				await this.backend.doCal('load');
				await this.backend.doCal('isoln');
				this.calibrationStep = 'thru';
			} else
			if (step === 'thru') {
				await this.backend.doCal('thru');
				this.calibrationStep = 'done';
			} else
			if (step === 'done') {
				await this.backend.doCal('done');
				await this.backend.doSave('save', argv);
				this.showCalibrationDialog = false;
				this.calibrationStep = 'reset';
			}
			this.calibrationRunning = false;
		},

		capture: async function () {
			this.showCaptureDialog = true;
			this.capturing = true;
			const data = await this.backend.getCapture();

			const canvas = this.$refs.capture;
			const ctx = canvas.getContext('2d');
			const imd = ctx.createImageData(320, 240);
			const rgba = imd.data;
			for (var i = 0, len = data.length; i < len; i++) {
				const c565 = data[i];
				const r = (c565 >> 11 & 0b011111) << 3;
				const g = (c565 >>  5 & 0b111111) << 2;
				const b = (c565 >>  0 & 0b011111) << 3;
				rgba[i * 4 + 0] = r;
				rgba[i * 4 + 1] = g;
				rgba[i * 4 + 2] = b;
				rgba[i * 4 + 3] = 0xff;
			}
			ctx.putImageData(imd, 0, 0);
			this.captureDownloadHref = canvas.toDataURL();
			this.capturing = false;
		},

		calcTDR: async function () {
			this.showTDRDialog = true;
			await Promise.resolve();

			if (!this.TDRChart || this.TDRChart.canvas !== this.$refs.TDR) {
				this.TDRChart = new Chart(this.$refs.TDR.getContext('2d'), {
					type: 'line',
					options: {
						responsive: true,
						maintainAspectRatio: false,
						legend: {
							display: false,
							position: 'top',
							padding: 0
						},
						layout: {
							padding: {
							}
						},
						elements: {
							point: {
								pointStyle: 'cross',
								radius: 1,
								hitRadius: 20,
								hoverRadius: 20,
								borderColor: 'black',
								borderWidth: 0,
								hoverBorderWidth: 1,
							},
							line: {
								fill: false,
								tension: 0,
							}
						},
						tooltips: {
							enabled: true,
							position: "nearest",
							mode: "index",
							intersect: false,
							/*
							callbacks: {
								label: (item, data) => {
									const {real, imag, freq} = data.datasets[item.datasetIndex].data[item.index];
									return `${(freq/1e6).toFixed(3)}MHz ${real.toFixed(3)} ${imag < 0 ? '-' : '+'} ${Math.abs(imag).toFixed(3)}j`;
								}
							}
							*/
						},
						animation: {
							duration: 250
						},
						scales: {
							xAxes: [
								{
									display: true,
									ticks: {
										maxTicksLimit: 11,
										callback: (tick) => (tick * (this.velocityOfSignalPropagation / 100)).toFixed(3) + 'm'
									},
									scaleLabel: {
										display: false,
										labelString: "distance (one way)"
									},
								}
							],
							yAxes: [
								{
									display: true,
									type: 'linear',
									ticks: {
									},
									scaleLabel: {
										display: false,
										labelString: "mag"
									}
								},
							]
						}
					},
					data: {
						labels: [],
						datasets: [
							{
								label: `CH0 TDR`,
								fill: false,
								/*
								borderColor: trace.color,
								backgroundColor: trace.color,
								*/
								data: [],
							}
						]
					}
				});
			}

			const SPEED_OF_LIGHT = 299792458;
			const velocityOfSignalPropagation = this.velocityOfSignalPropagation / 100;

			const tdr = await this.backend.calcTDR();
			console.log(tdr);
			console.log({velocityOfSignalPropagation});

			const distances = Array.from(tdr.time.map( (i) => i * SPEED_OF_LIGHT / 2));
			console.log(Math.max(...tdr.mag));
			this.peakTDR = distances[tdr.mag.indexOf(Math.max(...tdr.mag))];

			this.TDRChart.data.labels = distances;
			this.TDRChart.data.datasets[0].data = Array.from(tdr.mag);
			this.TDRChart.update();
		},

		editTrace: function (trace) {
			this.currentTraceSetting = Object.assign({ src: trace }, trace);
			this.showTraceDialog = true;
		},

		addTrace: function () {
			this.currentTraceSetting = {
				show: true,
				channel: 0,
				format: 'logmag',
				color: this.colorGen()
			};
			this.showTraceDialog = true;
		},

		saveTrace: function () {
			const src = this.currentTraceSetting.src;
			const isNew = !src;
			if (isNew) {
				this.traces.push(this.currentTraceSetting);
			} else {
				const target = this.traces.findIndex((i) => i === src);
				delete this.currentTraceSetting.src;
				this.traces.splice(target, 1, this.currentTraceSetting);
			}
			this.showTraceDialog = false;
		},

		deleteTrace: function () {
			const src = this.currentTraceSetting.src;
			const target = this.traces.findIndex((i) => i === src);
			this.traces.splice(target, 1);
			this.showTraceDialog = false;
		},

		nameOfFormat: function (format) {
			// XXX
			return format.toUpperCase();
		},

		saveLastStateToLocalStorage: function () {
			const saving = {
				traces: this.traces
			};
			console.log('save to localStorage', saving);
			localStorage.setItem('nanovna', JSON.stringify(saving));
		},

		loadLastStateFromLocalStorage: function () {
			let saved;
			try {
				saved = JSON.parse(localStorage.getItem('nanovna')) || {};
			} catch (e) {
				saved = {};
			}

			console.log('load from localStorage', saved);

			if (saved.traces) {
				this.traces = saved.traces;
			}
		}
	},

	created: async function () {
		this.colorGen = colorGen();

		this.backend = await new Backend();
		await this.backend.init(Comlink.proxy({
			onerror: (e) => {
				console.log('onerror', e);
			},
			ondisconnected:() => {
				console.log('disconnected');
				this.status = 'disconnected';
			},
		}));
		const device = (await navigator.usb.getDevices())[0];
		this.connect(device);

		const updateStartStop = async () => {
			/*
			const [start, stop] = [ +this.range.start, +this.range.stop ];
			const span   = stop - start;
			const center = span / 2 + start;
			console.log('updateStartStop', this.range.center, this.range.span, {center, span});
			this.range.center = center;
			this.range.span = span;
			*/
			if (this.connected && this.range.focusing) {
				await this.backend.setSweep(this.range.focusing, this.range[this.range.focusing] * 1e6);
			}
		};

		const updateCenterSpan = async () => {
			/*
			const [center, span] = [ +this.range.center, +this.range.span ];
			const start = center - (span / 2);
			const stop = center + (span / 2);
			this.range.start = start;
			this.range.stop = stop;
			*/
			if (this.connected && this.range.focusing) {
				await this.backend.setSweep(this.range.focusing, this.range[this.range.focusing] * 1e6);
			}
		};

		this.$watch('range.start', updateStartStop);
		this.$watch('range.stop', updateStartStop);
		this.$watch('range.center', updateCenterSpan);
		this.$watch('range.span', updateCenterSpan);

		let updateTimer;
		this.$watch('range.focusing', (newVal) => {
			clearTimeout(updateTimer);
			if (newVal === "") {
				updateTimer = setTimeout(() => {
					this.update();
				}, 500);
			}
		});

		const updateFunctions = [];
		const updateGraph = () => {
			for (let update of updateFunctions) {
				update();
			}

			this.freqChart.data.labels = this.data.ch0.map(i => i.freq);
			this.smithChart.update();
			this.freqChart.update();
		}

		this.$watch('traces', () => {
			updateFunctions.length = 0;
			this.smithChart.data.datasets = [];
			this.freqChart.data.datasets = [];

			console.log(this.traces);

			const axisSet = new Set();
			for (let trace of this.traces) {
				if (!trace.show) continue;
				const [chart, func, yAxisID] = {
					'smith': [this.smithChart, calcZr, undefined],
					'logmag': [this.freqChart, calcLogMag, 'y-axis-dB'],
					'phase': [this.freqChart, calcPhase, 'y-axis-phase'],
					'swr': [this.freqChart, calcSWR, 'y-axis-swr'],
					'linear': [this.freqChart, calcLinear, 'y-axis-z'],
					'real': [this.freqChart, calcReal, 'y-axis-z'],
					'imag': [this.freqChart, calcImag, 'y-axis-z'],
					'R': [this.freqChart, calcZR, 'y-axis-z'],
					'X': [this.freqChart, calcZX, 'y-axis-z'],
					'Z': [this.freqChart, calcZabs, 'y-axis-z'],
				}[trace.format];

				if (yAxisID) axisSet.add(yAxisID);

				const n = chart.data.datasets.length;
				chart.data.datasets.push({
					label: `CH${trace.channel} ${trace.format}`,
					fill: false,
					borderColor: trace.color,
					backgroundColor: trace.color,
					data: [],
					yAxisID: yAxisID
				});

				updateFunctions.push(() => {
					chart.data.datasets[n].data = this.data[`ch${trace.channel}`].map(func);
				});
			}

			this.availableSmithChart = !!this.smithChart.data.datasets.length;
			this.availableFreqChart  = !!this.freqChart.data.datasets.length;

			for (let yAxis of this.freqChart.options.scales.yAxes) {
				yAxis.display = axisSet.has(yAxis.id);
			}

			updateGraph();
			this.saveLastStateToLocalStorage();
		});

		this.$watch('data.ch0', updateGraph);
		this.$watch('data.ch1', updateGraph);

		this.$watch('velocityOfSignalPropagation', () => {
			if (this.TDRChart) {
				this.TDRChart.update();
			}
		});


		this.traces = [
			{
				show: true,
				channel: 0,
				format: 'smith',
				color: this.colorGen()
			},
			{
				show: true,
				channel: 0,
				format: 'logmag',
				color: this.colorGen()
			},
			{
				show: true,
				channel: 1,
				format: 'logmag',
				color: this.colorGen()
			},
		];

		this.loadLastStateFromLocalStorage();
	},

	mounted: async function () {
		

		this.smithChart = new Chart(this.$refs.smith.getContext('2d'), {
			type: 'smith',
			options: {
				responsive: true,
				maintainAspectRatio: false,
				legend: {
					display: false
				},
				elements: {
					point: {
						pointStyle: 'cross',
						radius: 1,
						hitRadius: 20,
						hoverRadius: 20,
						borderColor: 'black',
						borderWidth: 0,
						hoverBorderWidth: 1,
					},
					line: {
						fill: false,
						tension: 0,
						borderCapStyle: 'round',
						borderJoinStyle: 'round',
					}
				},
				tooltips: {
					enabled: true,
					mode: "nearest",
					callbacks: {
						label: (item, data) => {
							const {real, imag, freq} = data.datasets[item.datasetIndex].data[item.index];
							return `${(freq/1e6).toFixed(3)}MHz ${real.toFixed(3)} ${imag < 0 ? '-' : '+'} ${Math.abs(imag).toFixed(3)}j`;
						}
					}
				},
				animation: {
					duration: 250
				},
				layout: {
					padding: {
						top: 0,
						left: 10,
						right: 10,
						bottom: 0,
					}
				},
			},
			data: {
				datasets: []
			}
		});

		this.$refs.smith.addEventListener("click", (e) => {
			const item = this.smithChart.getElementAtEvent(e)[0];
			if (!item) return;
			let data = item._chart.config.data.datasets[item._datasetIndex].data[item._index];
			console.log(data);
		});

		this.freqChart = new Chart(this.$refs.freq.getContext('2d'), {
			type: 'line',
			options: {
				responsive: true,
				maintainAspectRatio: false,
				legend: {
					display: false,
					position: 'top',
					padding: 0
				},
				layout: {
					padding: {
					}
				},
				elements: {
					point: {
						pointStyle: 'cross',
						radius: 1,
						hitRadius: 20,
						hoverRadius: 20,
						borderColor: 'black',
						borderWidth: 0,
						hoverBorderWidth: 1,
					},
					line: {
						fill: false,
						tension: 0,
					}
				},
				tooltips: {
					enabled: true,
					position: "nearest",
					mode: "index",
					intersect: false,
					/*
					callbacks: {
						label: (item, data) => {
							const {real, imag, freq} = data.datasets[item.datasetIndex].data[item.index];
							return `${(freq/1e6).toFixed(3)}MHz ${real.toFixed(3)} ${imag < 0 ? '-' : '+'} ${Math.abs(imag).toFixed(3)}j`;
						}
					}
					*/
				},
				animation: {
					duration: 250
				},
				scales: {
					xAxes: [
						{
							display: true,
							ticks: {
								maxTicksLimit: 11,
								callback: (tick) => (tick / 1e6).toFixed(0) + 'MHz'
							},
							scaleLabel: {
								display: false,
								labelString: "frequency"
							},
							afterFit: (scale) => scale.height = 50,
						}
					],
					yAxes: [
						{
							id: 'y-axis-dB',
							display: true,
							type: 'linear',
							ticks: {
								min: -80.0,
								max: 0.0,
								callback: (tick) => tick.toString() + 'dB'
							},
							scaleLabel: {
								display: false,
								labelString: "mag [dB]"
							}
						},
						{
							id: 'y-axis-swr',
							display: true,
							type: 'linear',
							ticks: {
								min: 1.0,
								max: 30.0,
								callback: (tick) => tick.toString() 
							},
							scaleLabel: {
								display: false,
								labelString: "SWR"
							},
							position: 'right',
							gridLines: {
								drawOnChartArea: false,
							}
						},
						{
							id: 'y-axis-phase',
							display: false,
							type: 'linear',
							ticks: {
								min: -90 * 3,
								max: +90 * 3,
								callback: (tick) => tick.toString() + '\u00b0'
							},
							scaleLabel: {
								display: false,
								labelString: "Phase"
							},
							position: 'right',
							gridLines: {
								drawOnChartArea: false,
							}
						},
						{
							id: 'y-axis-z',
							display: false,
							type: 'linear',
							ticks: {
								min: -100,
								max: +100,
								callback: (tick) => tick.toString() + '\u03a9'
							},
							scaleLabel: {
								display: false,
								labelString: "Z"
							},
							position: 'right',
							gridLines: {
								drawOnChartArea: false,
							}
						},
					]
				}
			},
			data: {
				labels: SAMPLE_DATA.map( (d) => d.freq ),
				datasets: [
				]
			}
		});

	}
});

