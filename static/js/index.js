let decompilerContainers = Object.fromEntries(
    Object.values(document.getElementsByClassName("decompiler_container"))
    .map(i => [i.id.replace(/(^container_)/, ''), i])
);

let decompilerFrames = Object.fromEntries(
    Object.values(document.getElementsByClassName("decompiler_output"))
    .map(i => [i.id, i])
);

let decompilerTimes = Object.fromEntries(
    Object.values(document.getElementsByClassName("decompiler_runtime"))
    .map(i => [i.id.replace(/(^runtime_)/, ''), i])
);

let decompilerTitles = Object.fromEntries(
    Object.values(document.getElementsByClassName("decompiler_title"))
    .map(i => [i.id.replace(/(^title_)/, ''), i])
);

let decompilerRerunButtons = Object.fromEntries(
    Object.values(document.getElementsByClassName("decompiler_rerun"))
    .map(i => [i.id.replace(/(^rerun_)/, ''), i])
);

let decompilerSelectChecks = Object.fromEntries(
    Object.values(document.getElementsByClassName("decompiler_select"))
    .map(i => [i.id.replace(/(^select_)/, ''), i])
);

let decompilerResultUrls = {};

let decompilers = JSON.parse(document.getElementById("decompilers_json").textContent);

Object.keys(decompilerSelectChecks).forEach((decompiler) => {
    let check = decompilerSelectChecks[decompiler];
    let info = decompilers[decompiler];
    check.checked = info.featured;
    check.addEventListener('change', () => {
        info.featured = check.checked;
        updateFrames();
    });
});

document.querySelector("#binary_upload_form input[name='file']").required = true;

let numDecompilers = Object.keys(decompilerFrames).length;
let resultUrl;

function logError(err_title, err_msg, do_alert=false) {
    console.error(err_title, err_msg);
    if (do_alert) {
        alert(err_title);
    }
}

function clearOutput(decompiler_name) {
    decompilerFrames[decompiler_name].contentDocument.body.innerText = "";
    decompilerTimes[decompiler_name].innerText = "";
    decompilerRerunButtons[decompiler_name].hidden = true;
    delete decompilerResultUrls[decompiler_name];
}

function updateFrames() {
    let hasPrevious = false;
    Object.keys(decompilerContainers).forEach((decompiler) => {
        let info = decompilers[decompiler];

        if (hasPrevious) {
            decompilerContainers[decompiler].classList.add('with_line');
        } else {
            decompilerContainers[decompiler].classList.remove('with_line');
        }

        if (info.featured) {
            decompilerContainers[decompiler].classList.remove('hidden');
            hasPrevious = true;
        } else {
            decompilerContainers[decompiler].classList.add('hidden');
        }
    });
}

function displayResult(resultData) {
    // If a new decompiler comes online before we refresh, it won't be in the list
    if (Object.keys(decompilers).indexOf(resultData['decompiler']['name']) === -1)
        return;
    let url = resultData['download_url'];
    let analysis_time = resultData['analysis_time'];
    let created = new Date(resultData['created']);
    let decompiler_name = resultData['decompiler']['name'];
    let decompiler_version = resultData['decompiler']['version'];
    let decompiler_revision = resultData['decompiler']['revision'];
    let frame = decompilerFrames[decompiler_name];
    let time_obj = decompilerTimes[decompiler_name];
    let rerun_button = decompilerRerunButtons[decompiler_name];
    decompilerResultUrls[decompiler_name] = resultData['url'];
    if (decompiler_revision !== '') {
        if (decompiler_revision.length > 8) {
            decompiler_revision = decompiler_revision.substring(0, 8);
        }
        decompilerTitles[decompiler_name].innerText = `${decompiler_name} ${decompiler_version} (${decompiler_revision})`;
    } else {
        decompilerTitles[decompiler_name].innerText = `${decompiler_name} ${decompiler_version}`;
    }
    time_obj.innerText = `Analysed ${created}\nAnalysis took ${analysis_time.toFixed(2)} seconds`;

    if (resultData['error'] !== null) {
        frame.contentDocument.body.innerText = `Error decompiling: ${resultData['error']}`;
        rerun_button.hidden = false;
        return;
    }

    fetch(url)
    .then(resp => resp.text())
    .then(data => {
        frame.contentDocument.body.innerHTML = data;
        rerun_button.hidden = false;
    })
    .catch(err => {
        logError("Error retrieving result", err);
        frame.contentDocument.body.innerText = "Error retrieving result";
    })
}


function getResult(decompiler_name) {
    let finishedResults = [];
    decompilerFrames[decompiler_name].contentDocument.body.innerText = "Waiting for data...";
    decompilerTimes[decompiler_name].innerText = "";
    decompilerRerunButtons[decompiler_name].hidden = true;

    let startTime = Date.now();

    let resultInterval = setInterval(() => {
        fetch(resultUrl)
        .then(resp => {
            if (resp.ok) {
                return resp.json();
            }
            else {
                throw Error("Error fetching results");
            }
        })
        .then(data => {
            for (let i of data['results']) {
                if (i['decompiler'] === null)
                    continue;
                let decompilerName = i['decompiler']['name'];
                if (!finishedResults.includes(decompilerName)) {
                    displayResult(i);
                    finishedResults.push(decompilerName);
                }
                if (finishedResults.length === numDecompilers) {
                    clearInterval(resultInterval);
                }
            }
            if (finishedResults.indexOf(decompiler_name) === -1) {
                let elapsedSecs = ((Date.now() - startTime) / 1000).toFixed(0);
                decompilerFrames[decompiler_name].contentDocument.body.innerText = "Waiting for data... (" + elapsedSecs + "s)";
            }
        })
    }, 1000);
}


function uploadBinary() {
    resultUrl = undefined;
    const csrfToken = document.querySelector('[name=csrfmiddlewaretoken]').value;

    let uploadForm = document.getElementById('binary_upload_form');
    if (!uploadForm.checkValidity()) {
        uploadForm.reportValidity();
        return;
    }
    let formData = new FormData(uploadForm);

    fetch('/api/binaries/', {
        method: 'POST',
        body: formData,
        headers: {'X-CSRFToken': csrfToken},
        mode: 'same-origin'
    })
    .then(async(resp) => {
        if (resp.ok) {
            return resp.json();
        }
        else {
            if (resp.status == 413) {
                throw Error("File too large");
            }
            if (resp.status == 429) {
                throw Error((await resp.json())['detail']);
            }
            else {
                throw Error("Error uploading binary");
            }
        }
    })
    .then(data => {
        addHistoryEntry(data['id']);
        loadAllDecompilers(data['id']);
    })
    .catch(err => {
        logError(err, err, true);
    });
}

function loadAllDecompilers(binary_id) {
    resultUrl = `${location.origin}${location.pathname}api/binaries/${binary_id}/decompilations/`;
    for (const decompiler_name of Object.keys(decompilerFrames)) {
        getResult(decompiler_name);
    }
}

function addHistoryEntry(binary_id) {
    const url = new URL(window.location);
    url.searchParams.set('id', binary_id);
    window.history.pushState({}, '', url);
}

function rerunDecompiler(decompiler_name) {
    const csrfToken = document.querySelector('[name=csrfmiddlewaretoken]').value;

    fetch(decompilerResultUrls[decompiler_name] + 'rerun/', {
        method: 'POST',
        headers: {'X-CSRFToken': csrfToken},
        mode: 'same-origin'
    })
    .then(resp => {
        if (!resp.ok) {
            throw Error("Error rerunning binary");
        }
    })
    .then(() => {
        clearOutput(decompiler_name);
        getResult(decompiler_name);
    })
    .catch(err => {
        logError(err, err, true);
    });
}


document.getElementById('upload_binary').addEventListener('click', (e) => {
    e.preventDefault();
    Object.values(decompilerTimes).forEach(i => i.innerHTML = "");
    Object.values(decompilerFrames).forEach(i => i.contentDocument.body.innerHTML = "");
    Object.values(decompilerRerunButtons).forEach(i => i.hidden = true);
    uploadBinary();
});
document.getElementById('try_sample').addEventListener('click', (e) => {
    e.preventDefault();
    Object.values(decompilerTimes).forEach(i => i.innerHTML = "");
    Object.values(decompilerFrames).forEach(i => i.contentDocument.body.innerHTML = "");
    Object.values(decompilerRerunButtons).forEach(i => i.hidden = true);
    let id = document.getElementById('samples').value;
    addHistoryEntry(id);
    loadAllDecompilers(id);
});

Object.entries(decompilerRerunButtons)
    .forEach(([name, elem]) => {
        elem.addEventListener('click', (e) => {
            e.preventDefault();
            rerunDecompiler(name);
        })
    });
updateFrames();

let params = new URL(location).searchParams;
let id = params.get("id");
if (id !== null) {
    let wasSample = false;
    let sampleSelect = document.getElementById('samples');
    for (let i = 0; i < sampleSelect.childElementCount; i ++) {
        if (sampleSelect.children[i].value === id) {
            sampleSelect.value = id;
            wasSample = true;
            break;
        }
    }

    if (!wasSample) {
        sampleSelect.value = "";
    }

    loadAllDecompilers(id);
}
